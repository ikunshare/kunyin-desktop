/*
 * 坤音的 AV3A（Audio Vivid）wasm 导出层：把 MOLAN-AV3A 的 C API 包成「一次一包」的极简接口。
 *
 * JS 侧（src/main/audio/av3aDecoder.ts）的用法：
 *   h = av3a_open()
 *   ptr = av3a_in_ptr(h, len) → 把一个完整的 MP4 样本（= 一个 AV3A 帧）拷进去
 *   n = av3a_packet(h, len)   → >0：解出 n 个采样帧（每声道），交错 s16 在 av3a_out_ptr(h)，
 *                                声道数 / 采样率由 av3a_channels / av3a_sample_rate 给出；
 *                               0：这包没出声；<0：MOLAN_AV3A_ERR_*
 *   av3a_reset(h)             → seek 用：重建上游解码器实例（参考解码器没有局部复位）
 *   av3a_close(h)
 *
 * 每路解码一个 WebAssembly.Instance（参考解码器有模块级状态，实例隔离最省心）。
 */
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#include "molan_av3a.h"

#define EXPORT(name) __attribute__((export_name(name)))

typedef struct {
    molan_av3a *dec;
    uint8_t *in;
    size_t in_cap;
    int channels;
    int sample_rate;
    int16_t out[MOLAN_AV3A_MAX_PCM_BYTES / 2];
} av3a_t;

EXPORT("av3a_open") av3a_t *av3a_open(void)
{
    av3a_t *h = (av3a_t *)calloc(1, sizeof(*h));
    if (!h)
        return NULL;
    h->dec = molan_av3a_new();
    if (!h->dec) {
        free(h);
        return NULL;
    }
    return h;
}

EXPORT("av3a_close") void av3a_close(av3a_t *h)
{
    if (!h)
        return;
    molan_av3a_free(h->dec);
    free(h->in);
    free(h);
}

EXPORT("av3a_in_ptr") uint8_t *av3a_in_ptr(av3a_t *h, size_t len)
{
    if (len > h->in_cap) {
        uint8_t *p = (uint8_t *)realloc(h->in, len);
        if (!p)
            return NULL;
        h->in = p;
        h->in_cap = len;
    }
    return h->in;
}

EXPORT("av3a_packet") int av3a_packet(av3a_t *h, size_t len)
{
    size_t consumed = 0;
    size_t bytes = 0;
    molan_av3a_frame_info info;
    int rc;

    if (!h || !h->dec || !len || len > h->in_cap)
        return MOLAN_AV3A_ERR_PARAM;
    rc = molan_av3a_decode(h->dec, h->in, len, h->out, sizeof(h->out), &consumed, &bytes);
    if (rc != MOLAN_AV3A_OK)
        return rc;
    if (!bytes)
        return 0;
    if (molan_av3a_get_frame_info(h->dec, &info) != MOLAN_AV3A_OK || info.channels <= 0)
        return MOLAN_AV3A_ERR_DECODE;
    h->channels = info.channels;
    h->sample_rate = info.sample_rate;
    return (int)(bytes / 2 / (size_t)info.channels);
}

EXPORT("av3a_out_ptr") int16_t *av3a_out_ptr(av3a_t *h) { return h->out; }
EXPORT("av3a_channels") int av3a_channels(av3a_t *h) { return h->channels; }
EXPORT("av3a_sample_rate") int av3a_sample_rate(av3a_t *h) { return h->sample_rate; }

EXPORT("av3a_reset") void av3a_reset(av3a_t *h)
{
    if (h && h->dec)
        molan_av3a_flush(h->dec);
}
