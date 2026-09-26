/*
 * LibreMPEG 杜比解码器（AC-3 / E-AC-3 / AC-4）的 wasm 薄封装（坤音自写）。
 *
 * 一路解码一个 Dec。两种喂法，按编码选：
 *
 * - AC-3 / E-AC-3：字节流。JS 把任意切分的码流字节写进 dec_in_ptr() 给的缓冲，调 dec_feed，
 *   这里过一遍 ac3 parser 切出整帧再送解码器。为什么一定要过 parser：取流是分块到的，块边界
 *   不会落在帧边界上；E-AC-3 的独立帧 + 依附子流（7.1 等）也要由 parser 拼成一个包，解码器才认。
 *   AC-3 和 E-AC-3 用同一个解码器，它按每帧头里的 bsid 自己切换。
 * - AC-4：按包。MP4 里一个样本就是一个完整的 raw_ac4_frame，JS 攒齐一个样本写进缓冲后调
 *   dec_packet。不走 parser：AC-4 的 parser 认的是带 0xAC40 同步字的裸流，MP4 样本没有同步字；
 *   而且一包进一帧出，JS 能按样本对齐时间轴（解码器在第一个 I 帧之前一律不出声，见 dec_packet）。
 *
 * PCM 追加进交错的 float 输出缓冲；JS 读完 dec_out_ptr()/dec_out_frames() 后调 dec_out_clear。
 */
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#include <libavcodec/avcodec.h>
#include <libavutil/channel_layout.h>
#include <libavutil/log.h>
#include <libavutil/opt.h>

#define EXPORT(name) __attribute__((export_name(name)))

/* 与 JS 侧（src/main/audio/dolbyDecoder.ts 的 CODEC_IDS）一一对应 */
enum { DEC_AC3 = 0, DEC_AC4 = 1 };

typedef struct Dec {
    AVCodecContext *ctx;
    AVCodecParserContext *parser; /* 只有 AC-3 系有 */
    AVPacket *pkt;
    AVFrame *frame;
    uint8_t *in;
    int in_cap;
    int in_len;       /* 本批输入长度 */
    int in_pos;       /* 已交给 parser 的字节数 */
    int flushed;      /* flush 已把 parser 吐空 */
    int pending;      /* d->frame 里压着一帧声道数变了的样本，等 JS 取走旧输出再追加 */
    float *out;       /* 交错 PCM */
    int out_frames;   /* 每声道样本数 */
    int out_cap;      /* 以 float 计 */
    int channels;
    int sample_rate;
    int errors;       /* 解码失败而跳过的帧数（坏帧不中断整条流） */
} Dec;

static void quiet_log(void *avcl, int level, const char *fmt, va_list vl)
{
    (void)avcl; (void)level; (void)fmt; (void)vl;
}

static int open_parser(Dec *d)
{
    if (d->ctx->codec_id != AV_CODEC_ID_EAC3) return 1;
    d->parser = av_parser_init(AV_CODEC_ID_EAC3);
    return d->parser != NULL;
}

/**
 * codec 见 DEC_*。stereo=1 时让 AC-3 系解码器按码流里的下混系数自己混成立体声
 * （比事后通用下混准）；AC-4 没有这个选项，IMS（immersive stereo）本来就是两声道。
 */
EXPORT("dec_open")
Dec *dec_open(int codec, int stereo)
{
    av_log_set_callback(quiet_log);
    const AVCodec *c = avcodec_find_decoder(codec == DEC_AC4 ? AV_CODEC_ID_AC4 : AV_CODEC_ID_EAC3);
    if (!c) return NULL;
    Dec *d = calloc(1, sizeof(*d));
    if (!d) return NULL;
    d->ctx = avcodec_alloc_context3(c);
    d->pkt = av_packet_alloc();
    d->frame = av_frame_alloc();
    if (!d->ctx || !d->pkt || !d->frame || !open_parser(d)) goto fail;
    if (stereo && codec != DEC_AC4) {
        AVChannelLayout st = AV_CHANNEL_LAYOUT_STEREO;
        if (av_opt_set_chlayout(d->ctx->priv_data, "downmix", &st, 0) < 0) goto fail;
    }
    if (avcodec_open2(d->ctx, c, NULL) < 0) goto fail;
    return d;
fail:
    avcodec_free_context(&d->ctx);
    if (d->parser) av_parser_close(d->parser);
    av_packet_free(&d->pkt);
    av_frame_free(&d->frame);
    free(d);
    return NULL;
}

EXPORT("dec_close")
void dec_close(Dec *d)
{
    if (!d) return;
    avcodec_free_context(&d->ctx);
    if (d->parser) av_parser_close(d->parser);
    av_packet_free(&d->pkt);
    av_frame_free(&d->frame);
    free(d->in);
    free(d->out);
    free(d);
}

/** 输入缓冲：保证至少 len 字节（末尾另留 FFmpeg 要求的 padding）。上一批没消化完前别写。 */
EXPORT("dec_in_ptr")
uint8_t *dec_in_ptr(Dec *d, int len)
{
    int need = len + AV_INPUT_BUFFER_PADDING_SIZE;
    if (need > d->in_cap) {
        uint8_t *p = realloc(d->in, need);
        if (!p) return NULL;
        d->in = p;
        d->in_cap = need;
    }
    memset(d->in + len, 0, AV_INPUT_BUFFER_PADDING_SIZE);
    return d->in;
}

static int append_frame(Dec *d)
{
    AVFrame *f = d->frame;
    int ch = f->ch_layout.nb_channels;
    if (f->format != AV_SAMPLE_FMT_FLTP || ch <= 0) return -1;
    d->channels = ch;
    d->sample_rate = f->sample_rate;
    int need = (d->out_frames + f->nb_samples) * ch;
    if (need > d->out_cap) {
        int cap = d->out_cap ? d->out_cap : 8192;
        while (cap < need) cap *= 2;
        float *p = realloc(d->out, (size_t)cap * sizeof(float));
        if (!p) return -1;
        d->out = p;
        d->out_cap = cap;
    }
    float *dst = d->out + (size_t)d->out_frames * ch;
    for (int i = 0; i < f->nb_samples; i++)
        for (int c = 0; c < ch; c++)
            *dst++ = ((const float *)f->extended_data[c])[i];
    d->out_frames += f->nb_samples;
    return 0;
}

/**
 * 把解码器里已出的帧都收进输出缓冲。声道数中途变了（节目切换）且缓冲里还有旧样本时
 * 停下（返回 1）：两种声道数的样本不能交错在一起，得等 JS 先取走旧的。
 */
static int drain(Dec *d)
{
    if (d->pending) {
        if (d->out_frames) return 1;
        if (append_frame(d) < 0) d->errors++;
        av_frame_unref(d->frame);
        d->pending = 0;
    }
    while (avcodec_receive_frame(d->ctx, d->frame) == 0) {
        if (d->out_frames && d->frame->ch_layout.nb_channels != d->channels) {
            d->pending = 1;
            return 1;
        }
        if (append_frame(d) < 0) d->errors++;
        av_frame_unref(d->frame);
    }
    return 0;
}

/**
 * 字节流模式（AC-3 系）。len>0：开始消化一批新输入（已写进 dec_in_ptr 的缓冲）；
 * len=0：接着消化上一批。flush=1 表示码流结束，把 parser 里攒着的最后一帧也吐出来。
 * 返回本次新增的样本帧数，负数为内部错误。dec_busy() 为真时要先取走输出、
 * dec_out_clear，再以 len=0 继续调，直到它为假才能写下一批输入。
 */
EXPORT("dec_feed")
int dec_feed(Dec *d, int len, int flush)
{
    if (!d->parser) return -1;
    if (len > 0) {
        d->in_len = len;
        d->in_pos = 0;
    }
    int before = d->out_frames;
    if (drain(d)) return d->out_frames - before;
    while (d->in_pos < d->in_len || (flush && !d->flushed)) {
        uint8_t *data = NULL;
        int size = 0;
        int left = d->in_len - d->in_pos;
        int used = av_parser_parse2(d->parser, d->ctx, &data, &size, d->in + d->in_pos, left,
                                    AV_NOPTS_VALUE, AV_NOPTS_VALUE, 0);
        if (used < 0) return -1;
        d->in_pos += used;
        if (size > 0) {
            d->pkt->data = data;
            d->pkt->size = size;
            if (avcodec_send_packet(d->ctx, d->pkt) < 0) d->errors++;
            if (drain(d)) break;
        } else if (left == 0) {
            d->flushed = 1; /* 空输入也吐不出东西了：parser 已空 */
        }
    }
    return d->out_frames - before;
}

/**
 * 按包模式（AC-4）：dec_in_ptr 缓冲里的 len 字节是一个完整的帧。返回本包解出的样本帧数：
 * 0 = 没出声（还没遇到 I 帧，或这包解坏了，后者计入 dec_errors），负数为内部错误。
 * 同样可能 busy（声道数中途变了），处理方式同 dec_feed，续调时 len 传 0。
 */
EXPORT("dec_packet")
int dec_packet(Dec *d, int len)
{
    int before = d->out_frames;
    if (len > 0) {
        d->pkt->data = d->in;
        d->pkt->size = len;
        if (avcodec_send_packet(d->ctx, d->pkt) < 0) d->errors++;
        d->pkt->data = NULL;
        d->pkt->size = 0;
    }
    drain(d);
    return d->out_frames - before;
}

EXPORT("dec_busy")
int dec_busy(Dec *d) { return d->pending || d->in_pos < d->in_len; }

EXPORT("dec_out_ptr")
float *dec_out_ptr(Dec *d) { return d->out; }

EXPORT("dec_out_frames")
int dec_out_frames(Dec *d) { return d->out_frames; }

EXPORT("dec_out_clear")
void dec_out_clear(Dec *d) { d->out_frames = 0; }

EXPORT("dec_channels")
int dec_channels(Dec *d) { return d->channels; }

EXPORT("dec_sample_rate")
int dec_sample_rate(Dec *d) { return d->sample_rate; }

EXPORT("dec_errors")
int dec_errors(Dec *d) { return d->errors; }

/** 清空解码状态（seek 后从新位置接着喂）；失败返回 0 */
EXPORT("dec_reset")
int dec_reset(Dec *d)
{
    avcodec_flush_buffers(d->ctx);
    av_frame_unref(d->frame);
    d->in_len = d->in_pos = d->flushed = d->pending = 0;
    d->out_frames = 0;
    if (!d->parser) return 1;
    av_parser_close(d->parser);
    d->parser = NULL;
    return open_parser(d);
}
