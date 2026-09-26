/**
 * 杜比软解流：MP4 封装的 AC-3 / E-AC-3（QQ 杜比全景声）、AC-4（网易杜比全景声）→ 立体声 float32 WAV 字节流。
 *
 * Chromium 解不了杜比，而播放链路的一切（音效图、频谱、媒体会话、倍速、seek）都挂在 <audio> 上，
 * 所以不另起一套播放器，而是在 kunyin:// 里把它变成 <audio> 认得的格式：WAV 的「字节 ↔ 时间」
 * 是线性的，<audio> 发来的任何 Range 都能换算成 PCM 帧 → MP4 样本 → 原文件偏移，只回源那一段。
 * （Electron 44 实测：float32 WAV 流式播放、Range seek 都正常，且 Chromium 不会去探文件尾。）
 *
 * - 只出立体声。AC-3 系的下混交给解码器按码流自带的系数做（dolbyDecoder 的 `stereo`），比拿到 5.1
 *   再通用下混准；网易的 AC-4 是 IMS，本来就是 Dolby 在编码端做好的两声道耳机渲染。
 *   音效图里的压缩器 / 声像节点本来就把声道数夹到 2，多声道原样送出去也到不了扬声器。
 * - 存 float32 而不是 16 位：下混后的峰值可能略过 1，截在容器里就是削波，留给 <audio> 的音量去处理。
 * - 数据长度按 MP4 样本表算死，响应头里的 Content-Length 必须兑现：解码器少吐的（坏帧、码流提前结束）
 *   在尾部补静音，多吐的截掉。上游真出错则照常报错，不拿静音顶替。
 *
 * 不 import electron：取字节的方式由调用方注入（OpenBytes），tools/dolbyStream.test.mjs 用文件模拟。
 */
import { createDolbyDecoder, type DolbyDecoder, type PcmChunk } from './dolbyDecoder'
import { Mp4Error, parseMoov, sampleAtFrame, syncAtOrBefore, type Mp4AudioTrack } from './mp4'

/** 已解密原文件从 start 起到文件尾的字节流，及文件总长 */
export type OpenBytes = (
  start: number
) => Promise<{ body: ReadableStream<Uint8Array>; size: number }>

/**
 * 原文件上的顺序读游标。往前跳一小段就读掉扔了（复用同一条上游连接），
 * 跳远了或往回跳才关掉当前流、在新位置重开（= 一次新的 Range 回源）。
 */
export interface ByteCursor {
  /** 下一个要交出的字节在原文件中的偏移 */
  readonly pos: number
  /** 原文件总长；第一次打开之前是 -1 */
  readonly size: number
  /** 下一段数据（不超过 max 字节）；到文件尾返回 null */
  next(max: number): Promise<Uint8Array | null>
  /** 读满 n 字节（到文件尾则少于 n） */
  read(n: number): Promise<Uint8Array>
  seek(pos: number): Promise<void>
  close(): void
}

/** 往前跳不超过这么多字节时顺着读过去，不另开连接 */
const READ_THROUGH = 256 * 1024

export function createByteCursor(open: OpenBytes, start = 0): ByteCursor {
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  let pending: Uint8Array | null = null
  let pos = start
  let size = -1
  let closed = false

  const drop = (): void => {
    void reader?.cancel().catch(() => {})
    reader = null
    pending = null
  }

  const fill = async (): Promise<boolean> => {
    if (pending?.length) return true
    if (closed) throw new Error('游标已关闭')
    if (!reader) {
      if (size >= 0 && pos >= size) return false
      const opened = await open(pos)
      if (closed) {
        void opened.body.cancel().catch(() => {})
        throw new Error('游标已关闭')
      }
      size = opened.size
      reader = opened.body.getReader()
    }
    const { done, value } = await reader.read()
    if (done || !value) {
      reader = null
      return false
    }
    pending = value
    return true
  }

  const next = async (max: number): Promise<Uint8Array | null> => {
    if (!(await fill()) || !pending) return null
    const out = pending.length > max ? pending.subarray(0, max) : pending
    pending = pending.length > max ? pending.subarray(max) : null
    pos += out.length
    return out
  }

  return {
    get pos() {
      return pos
    },
    get size() {
      return size
    },
    next,
    async read(n) {
      const parts: Uint8Array[] = []
      let got = 0
      while (got < n) {
        const part = await next(n - got)
        if (!part) break
        parts.push(part)
        got += part.length
      }
      if (parts.length === 1) return parts[0]
      const out = new Uint8Array(got)
      let off = 0
      for (const p of parts) {
        out.set(p, off)
        off += p.length
      }
      return out
    },
    async seek(target) {
      if (target === pos) return
      if (target > pos && target - pos <= READ_THROUGH && (reader || pending)) {
        while (pos < target) if (!(await next(target - pos))) return
        return
      }
      drop()
      pos = target
    },
    close() {
      closed = true
      drop()
    }
  }
}

/** moov 的上限：正常几 KB（6000 多个样本的定长表 7KB），再大就是坏文件 */
const MAX_MOOV = 16 * 1024 * 1024

/**
 * 从文件头起逐个跳过顶层盒找 moov，解析出音轨样本表。
 * faststart 布局（QQ 的就是）只读开头几 KB，游标停在 moov 之后——紧接着就是 mdat，
 * 首播的解码可以顺着这条连接读下去。moov 在尾部时 seek 会重开一次，同样能找到。
 */
export async function loadTrack(cursor: ByteCursor): Promise<Mp4AudioTrack> {
  await cursor.seek(0)
  for (;;) {
    const at = cursor.pos
    const head = new Uint8Array(16)
    const small = await cursor.read(8)
    if (small.length < 8) throw new Mp4Error('找不到 moov')
    head.set(small)
    const dv = new DataView(head.buffer)
    const type = String.fromCharCode(head[4], head[5], head[6], head[7])
    let size = dv.getUint32(0)
    let header = 8
    if (size === 1) {
      const large = await cursor.read(8)
      if (large.length < 8) throw new Mp4Error('找不到 moov')
      head.set(large, 8)
      size = Number(dv.getBigUint64(8))
      header = 16
    } else if (size === 0) {
      size = cursor.size - at
    }
    if (size < header) throw new Mp4Error(`${type} 盒长度非法`)
    if (type === 'moof') throw new Mp4Error('不支持分片 MP4')
    if (type === 'moov') {
      if (size > MAX_MOOV) throw new Mp4Error('moov 过大')
      const body = await cursor.read(size - header)
      if (body.length < size - header) throw new Mp4Error('moov 不完整')
      const moov = new Uint8Array(size)
      moov.set(head.subarray(0, header))
      moov.set(body, header)
      return parseMoov(moov)
    }
    if (cursor.size >= 0 && at + size >= cursor.size) throw new Mp4Error('找不到 moov')
    await cursor.seek(at + size)
  }
}

// ============ WAV ============

const WAV_HEADER = 44
const CHANNELS = 2
const BYTES_PER_SAMPLE = 4
const BLOCK_ALIGN = CHANNELS * BYTES_PER_SAMPLE

export interface WavLayout {
  sampleRate: number
  /** PCM 总帧数（= MP4 样本表的总时长） */
  frames: number
  /** 整个 WAV 文件的字节数（含 44 字节头） */
  size: number
}

export function wavLayout(track: Mp4AudioTrack): WavLayout {
  const frames = track.starts[track.starts.length - 1]
  return { sampleRate: track.sampleRate, frames, size: WAV_HEADER + frames * BLOCK_ALIGN }
}

/** WAVE_FORMAT_IEEE_FLOAT 立体声头 */
export function wavHeader(layout: WavLayout): Uint8Array {
  const b = new Uint8Array(WAV_HEADER)
  const dv = new DataView(b.buffer)
  const ascii = (at: number, s: string): void => {
    for (let i = 0; i < s.length; i++) b[at + i] = s.charCodeAt(i)
  }
  const dataBytes = layout.size - WAV_HEADER
  ascii(0, 'RIFF')
  dv.setUint32(4, layout.size - 8, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  dv.setUint32(16, 16, true)
  dv.setUint16(20, 3, true) // IEEE float
  dv.setUint16(22, CHANNELS, true)
  dv.setUint32(24, layout.sampleRate, true)
  dv.setUint32(28, layout.sampleRate * BLOCK_ALIGN, true)
  dv.setUint16(32, BLOCK_ALIGN, true)
  dv.setUint16(34, BYTES_PER_SAMPLE * 8, true)
  ascii(36, 'data')
  dv.setUint32(40, dataBytes, true)
  return b
}

const SQRT1_2 = Math.SQRT1_2

/**
 * 解码器吐出的段统一成交错立体声。常规情况已经是两声道（AC-3 系由解码器按码流系数下混，
 * 网易 AC-4 是 IMS），这里只兜少见的：单声道复制两份；AC-4 万一给了多声道（非 IMS 的 5.x / 7.x
 * 节目）按 ITU 系数下混——只取前两路会把中置里的人声整个丢掉。声道次序是 FFmpeg 的默认布局：
 * FL FR FC [LFE] 左右环绕…，LFE 不进下混；系数和归一到 1，宁可轻一点也不削波。
 */
function toStereo(chunk: PcmChunk): Float32Array {
  const { channels, frames, data } = chunk
  if (channels === CHANNELS) return data
  const out = new Float32Array(frames * CHANNELS)
  if (channels < 3) {
    for (let i = 0; i < frames; i++) out[i * 2] = out[i * 2 + 1] = data[i * channels]
    return out
  }
  const lfe = channels === 6 || channels === 8 ? 3 : -1
  const surrounds: number[] = []
  for (let c = 3; c < channels; c++) if (c !== lfe) surrounds.push(c)
  const pairs = Math.floor(surrounds.length / 2)
  const norm = 1 / (1 + SQRT1_2 + SQRT1_2 * pairs)
  for (let i = 0; i < frames; i++) {
    const f = i * channels
    let l = data[f] + SQRT1_2 * data[f + 2]
    let r = data[f + 1] + SQRT1_2 * data[f + 2]
    for (let k = 0; k + 1 < surrounds.length; k += 2) {
      l += SQRT1_2 * data[f + surrounds[k]]
      r += SQRT1_2 * data[f + surrounds[k + 1]]
    }
    out[i * 2] = l * norm
    out[i * 2 + 1] = r * norm
  }
  return out
}

/**
 * seek 时要往前多解几帧再扔掉，结果才与从头播放一致。返回应从哪个样本开始解。
 * - AC-3 系：相邻帧的 MDCT 窗口互相重叠，冷启动那一帧开头不准（实测误差 5e-2），多解 1 帧即可。
 *   剩下与从头播放的差异（~1e-3）是解码器给零尾数加的随机抖动，种子随解码状态走，多预热也不收敛，
 *   本来就是噪声，不必追。
 * - AC-4：只能从 I 帧（stss 里的同步样本）起解，之前的帧解码器一律不出声；而 I 帧只重置码流状态，
 *   变换重叠和 QMF 滤波器还要靠前面的帧——从 I 帧起解，第 1 帧误差 0.3、第 2 帧 5e-2、第 3 帧起
 *   逐样本一致（网易实测）。所以退到目标之前至少 2 帧处最近的那个 I 帧。
 */
function warmupStart(track: Mp4AudioTrack, target: number): number {
  if (track.codec === 'ac-4') return syncAtOrBefore(track, Math.max(0, target - 2))
  return Math.max(0, target - 1)
}

/**
 * 每次最多从原文件读这么多字节去解：限住单次 pull 占用主进程的时间。
 * AC-4 最重（约 56× 实时），16KB 在 256kbps 下约 0.5s 音频、9ms；E-AC-3 快一个数量级。
 */
const FEED_CHUNK = 16 * 1024
const SILENCE_CHUNK = 64 * 1024

export interface WavStreamOptions {
  track: Mp4AudioTrack
  layout: WavLayout
  /** 位置任意，这里会自己 seek；流结束（含被取消）时由这里关掉 */
  cursor: ByteCursor
  /** WAV 文件内的字节区间（闭区间） */
  start: number
  end: number
  /** 流终结时恰好调用一次（读完 / 出错 / 被取消） */
  onClose?: () => void
  /** 便于测试注入的解码器工厂（默认 wasm 解码器）；AC-4 没有开源编码器，做不出真夹具 */
  createDecoder?: typeof createDolbyDecoder
}

/**
 * 生成 WAV 文件 [start, end] 这一段。
 * @throws wasm 解码器不可用时同步抛出，调用方据此直接回错误码，别等 <audio> 读了一半才失败
 */
export function decodeToWav(opts: WavStreamOptions): ReadableStream<Uint8Array> {
  const { track, layout, cursor } = opts
  const ac4 = track.codec === 'ac-4'
  const decoder: DolbyDecoder | null = (opts.createDecoder ?? createDolbyDecoder)({
    codec: ac4 ? 'ac4' : 'ac3',
    stereo: true
  })
  if (!decoder) throw new Error('杜比解码器不可用')

  let remaining = opts.end - opts.start + 1
  let header: Uint8Array | null =
    opts.start < WAV_HEADER ? wavHeader(layout).subarray(opts.start, opts.end + 1) : null
  const firstFrame =
    opts.start < WAV_HEADER ? 0 : Math.floor((opts.start - WAV_HEADER) / BLOCK_ALIGN)
  /** Range 起点不一定落在帧边界上（Chromium 按 32KB 块对齐请求），首段 PCM 要先切掉这几字节 */
  let skipBytes = opts.start < WAV_HEADER ? 0 : (opts.start - WAV_HEADER) % BLOCK_ALIGN
  let sample = warmupStart(track, sampleAtFrame(track, firstFrame))
  let discard = firstFrame - track.starts[sample]
  const count = track.sizes.length
  /** 游标可能停在任何地方（刚读完 moov、或 moov 在文件尾），第一次喂之前必须对准起始样本 */
  let positioned = false
  let sourceDone = false
  let flushed = false
  let closed = false
  const queue: Uint8Array[] = []
  /** AC-4：跨块的样本先攒在这里，齐了再整包送 */
  let partial: Uint8Array | null = null

  const finish = (): void => {
    if (closed) return
    closed = true
    cursor.close()
    decoder.close()
    opts.onClose?.()
  }

  const collect = (chunks: PcmChunk[]): void => {
    for (const chunk of chunks) {
      let pcm = toStereo(chunk)
      if (discard > 0) {
        const drop = Math.min(discard, chunk.frames)
        discard -= drop
        pcm = pcm.subarray(drop * CHANNELS)
      }
      if (!pcm.length) continue
      let bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength)
      if (skipBytes) {
        bytes = bytes.subarray(skipBytes)
        skipBytes = 0
      }
      queue.push(bytes)
    }
  }

  /**
   * AC-4 一包一帧，按样本严格对齐时间轴：解码器少吐（坏帧；I 帧之前的帧）补静音、多吐截掉，
   * 否则一次解坏就会让之后的声音整体错位，与 <audio> 按字节换算出的时间对不上。
   */
  const decodePacket = (i: number, frame: Uint8Array): void => {
    const expected = track.starts[i + 1] - track.starts[i]
    const out = decoder.packet(frame)
    if (out.length === 1 && out[0].frames === expected) {
      collect(out)
      return
    }
    const pcm = new Float32Array(expected * CHANNELS)
    let off = 0
    for (const chunk of out) {
      const part = toStereo(chunk)
      const n = Math.min(part.length, pcm.length - off)
      pcm.set(part.subarray(0, n), off)
      off += n
    }
    collect([{ channels: CHANNELS, sampleRate: track.sampleRate, frames: expected, data: pcm }])
  }

  /** 读一段原文件，把落在样本里的字节喂给解码器（样本间的空隙——别的轨、盒头——跳过） */
  const feed = async (): Promise<void> => {
    if (sample >= count) {
      sourceDone = true
      return
    }
    // 之后游标只会停在当前样本内部或它之前的空隙里，往前对齐即可
    if (!positioned || cursor.pos < track.offsets[sample]) await cursor.seek(track.offsets[sample])
    positioned = true
    const p = cursor.pos
    const chunk = await cursor.next(FEED_CHUNK)
    if (!chunk) {
      sourceDone = true
      return
    }
    const q = p + chunk.length
    let runStart = -1
    let runEnd = -1
    const run = (): void => {
      if (runStart < runEnd) collect(decoder.decode(chunk.subarray(runStart - p, runEnd - p)))
    }
    while (sample < count) {
      const o = track.offsets[sample]
      const e = o + track.sizes[sample]
      if (o >= q) break
      const s = Math.max(o, p)
      const t = Math.min(e, q)
      if (ac4) {
        if (s === o && t === e) decodePacket(sample, chunk.subarray(o - p, e - p))
        else if (s < t) {
          partial ??= new Uint8Array(e - o)
          partial.set(chunk.subarray(s - p, t - p), s - o)
          if (t === e) {
            decodePacket(sample, partial)
            partial = null
          }
        }
      } else if (s < t) {
        if (s !== runEnd) {
          run()
          runStart = s
        }
        runEnd = t
      }
      if (e > q) break
      sample++
    }
    run()
    if (sample >= count) sourceDone = true
  }
  const push = (
    controller: ReadableStreamDefaultController<Uint8Array>,
    bytes: Uint8Array
  ): void => {
    const out = bytes.length > remaining ? bytes.subarray(0, remaining) : bytes
    remaining -= out.length
    controller.enqueue(out)
  }

  return new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        try {
          for (;;) {
            if (remaining <= 0) {
              finish()
              controller.close()
              return
            }
            if (header) {
              push(controller, header)
              header = null
              return
            }
            const next = queue.shift()
            if (next) {
              push(controller, next)
              return
            }
            if (!sourceDone) await feed()
            else if (!flushed) {
              flushed = true
              collect(decoder.flush())
            } else {
              // 码流已吐干净，数据段还没填满：补静音兑现 Content-Length
              push(controller, new Uint8Array(Math.min(remaining, SILENCE_CHUNK)))
              return
            }
          }
        } catch (e) {
          finish()
          controller.error(e)
        }
      },
      cancel() {
        finish()
      }
    },
    // 跟 streamGuard 同理：不预读，<audio> 不要数据时就不去碰上游
    { highWaterMark: 0 }
  )
}
