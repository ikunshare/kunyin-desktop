/**
 * 杜比软解：AC-3 / E-AC-3 / AC-4（native/dolby-wasm：LibreMPEG 的解码器编成 wasm）。
 *
 * Chromium 不带杜比解码器（Electron 44 实测 canPlayType 对 ac-3 / ec-3 / ac-4 均为空），
 * 所以这类码流只能在主进程里自己解成 PCM 再交给 <audio>（见 dolbyStream.ts）。
 *
 * 两种喂法，按编码选（原因见 shim.c 文件头）：
 * - 'ac3'（AC-3 与 E-AC-3 共用）：decode() 喂任意切分的码流字节，wasm 侧先过 ac3 parser 切出整帧；
 *   E-AC-3 的依附子流（7.1 等）也由它拼好。
 * - 'ac4'：packet() 一次喂一个完整的帧（MP4 的一个样本）。第一个 I 帧之前的帧不出声。
 * 输出都是交错 float PCM。
 *
 * 跟 crypto/qmcWasm.ts 一样刻意不 import core/logger（那条链会拉进 electron），
 * 好让 tools/dolbyDecoder.test.mjs 在纯 Node 里跑；状态由 dolbyWasmStatus() 暴露。
 */
import { randomFillSync } from 'node:crypto'
import { DOLBY_WASM_BASE64 } from './dolbyWasmBinary'

/** 'ac3' 同时覆盖 AC-3 与 E-AC-3（同一个解码器按帧头的 bsid 切换） */
export type DolbyCodec = 'ac3' | 'ac4'

/** 与 shim.c 的 DEC_* 一一对应 */
const CODEC_IDS: Record<DolbyCodec, number> = { ac3: 0, ac4: 1 }

/** 一段解出的 PCM；声道数/采样率以段为单位（码流中途换节目时会变） */
export interface PcmChunk {
  channels: number
  sampleRate: number
  /** 每声道样本数 */
  frames: number
  /** 交错排列，长度 frames × channels */
  data: Float32Array
}

export interface DolbyDecoder {
  readonly codec: DolbyCodec
  /** 'ac3'：喂一段码流，返回这段新解出的 PCM（多数情况 0～1 段） */
  decode(bytes: Uint8Array): PcmChunk[]
  /** 'ac4'：喂一个完整的帧，返回它解出的 PCM；没出声（I 帧之前、坏帧）返回空数组 */
  packet(frame: Uint8Array): PcmChunk[]
  /** 码流结束：把 parser 里攒着的最后一帧也吐出来（'ac4' 无事可做） */
  flush(): PcmChunk[]
  /** 丢掉内部状态，从新位置接着喂（seek）；'ac4' 之后要从 I 帧喂起才出声 */
  reset(): void
  /** 解坏而跳过的帧数 */
  readonly errors: number
  close(): void
}

interface DolbyExports {
  memory: WebAssembly.Memory
  _initialize(): void
  dec_open(codec: number, stereo: number): number
  dec_close(d: number): void
  dec_in_ptr(d: number, len: number): number
  dec_feed(d: number, len: number, flush: number): number
  dec_packet(d: number, len: number): number
  dec_busy(d: number): number
  dec_out_ptr(d: number): number
  dec_out_frames(d: number): number
  dec_out_clear(d: number): void
  dec_channels(d: number): number
  dec_sample_rate(d: number): number
  dec_errors(d: number): number
  dec_reset(d: number): number
}

let cachedModule: WebAssembly.Module | null | undefined
let failReason = ''

function getModule(): WebAssembly.Module | null {
  if (cachedModule !== undefined) return cachedModule
  try {
    cachedModule = new WebAssembly.Module(Buffer.from(DOLBY_WASM_BASE64, 'base64'))
  } catch (e) {
    cachedModule = null
    failReason = e instanceof Error ? e.message : String(e)
  }
  return cachedModule
}

/** 诊断用：杜比软解是否可用；不可用时给出原因 */
export function dolbyWasmStatus(): { available: boolean; reason?: string } {
  return getModule() ? { available: true } : { available: false, reason: failReason || '未知原因' }
}

const ERRNO_BADF = 8
const ERRNO_NOSYS = 52

/**
 * wasi-libc 需要的系统调用桩。解码器用不到文件、环境变量：一律「没有」；
 * 只有 libc 初始化会问环境变量个数（报错它会直接退出，所以要老实答 0），
 * av_log 默认回调已在 shim 里换成空函数，fd_write 兜底吞掉。
 */
function wasiImports(memory: () => WebAssembly.Memory): WebAssembly.ModuleImports {
  const view = (): DataView => new DataView(memory().buffer)
  const known: WebAssembly.ModuleImports = {
    environ_sizes_get: (countPtr: number, sizePtr: number) => {
      view().setUint32(countPtr, 0, true)
      view().setUint32(sizePtr, 0, true)
      return 0
    },
    environ_get: () => 0,
    clock_time_get: (_id: number, _precision: bigint, outPtr: number) => {
      view().setBigUint64(outPtr, process.hrtime.bigint(), true)
      return 0
    },
    random_get: (ptr: number, len: number) => {
      randomFillSync(new Uint8Array(memory().buffer, ptr, len))
      return 0
    },
    fd_write: (_fd: number, iovs: number, iovsLen: number, nwrittenPtr: number) => {
      const v = view()
      let n = 0
      for (let i = 0; i < iovsLen; i++) n += v.getUint32(iovs + i * 8 + 4, true)
      v.setUint32(nwrittenPtr, n, true)
      return 0
    },
    fd_prestat_get: () => ERRNO_BADF,
    proc_exit: (code: number) => {
      throw new Error(`dolby wasm 调用了 proc_exit(${code})`)
    }
  }
  return new Proxy(known, { get: (t, name: string) => t[name] ?? (() => ERRNO_NOSYS) })
}

/**
 * 新建一路解码器；wasm 不可用返回 null。每路一个实例：解码器状态、输出缓冲都在该实例的
 * 线性内存里，丢掉实例就整块回收，播放流与下载任务也互不干扰。
 *
 * @param stereo 让 AC-3 系解码器按码流自带的下混系数混成立体声（比拿到多声道再通用下混准）。
 *   AC-4 没有这个选项：网易那路是 IMS（immersive stereo），本来就是 Dolby 做好的两声道耳机渲染。
 */
export function createDolbyDecoder(opts: {
  codec: DolbyCodec
  stereo?: boolean
}): DolbyDecoder | null {
  const mod = getModule()
  if (!mod) return null
  let ex: DolbyExports
  try {
    const instance = new WebAssembly.Instance(mod, {
      wasi_snapshot_preview1: wasiImports(() => ex.memory)
    })
    ex = instance.exports as unknown as DolbyExports
    ex._initialize()
  } catch (e) {
    failReason = e instanceof Error ? e.message : String(e)
    return null
  }
  const d = ex.dec_open(CODEC_IDS[opts.codec], opts.stereo ? 1 : 0)
  if (!d) return null
  let closed = false

  /** 取走 wasm 侧已攒的输出（memory 可能 grow 过，视图每次现建） */
  const take = (out: PcmChunk[]): void => {
    const frames = ex.dec_out_frames(d)
    if (!frames) return
    const channels = ex.dec_channels(d)
    const src = new Float32Array(ex.memory.buffer, ex.dec_out_ptr(d), frames * channels)
    out.push({ channels, sampleRate: ex.dec_sample_rate(d), frames, data: src.slice() })
    ex.dec_out_clear(d)
  }

  /** 把输入拷进 wasm 的输入缓冲，返回长度 */
  const put = (bytes: Uint8Array | null): number => {
    if (closed) throw new Error('解码器已关闭')
    if (!bytes?.length) return 0
    const ptr = ex.dec_in_ptr(d, bytes.length)
    if (!ptr) throw new Error('dolby wasm 分配输入缓冲失败')
    new Uint8Array(ex.memory.buffer, ptr, bytes.length).set(bytes)
    return bytes.length
  }

  // busy：声道数中途变了，wasm 停在分界处等我们先把旧段取走，再以 len=0 续调
  const feed = (bytes: Uint8Array | null, flush: boolean): PcmChunk[] => {
    const out: PcmChunk[] = []
    let len = put(bytes)
    do {
      if (ex.dec_feed(d, len, flush ? 1 : 0) < 0) throw new Error('dolby wasm 解析失败')
      len = 0
      take(out)
    } while (ex.dec_busy(d))
    return out
  }

  const packet = (frame: Uint8Array): PcmChunk[] => {
    const out: PcmChunk[] = []
    let len = put(frame)
    do {
      if (ex.dec_packet(d, len) < 0) throw new Error('dolby wasm 解码失败')
      len = 0
      take(out)
    } while (ex.dec_busy(d))
    return out
  }

  return {
    codec: opts.codec,
    decode: (bytes) => {
      if (opts.codec !== 'ac3') throw new Error('AC-4 要按帧喂（packet）')
      return feed(bytes, false)
    },
    packet: (frame) => {
      if (opts.codec !== 'ac4') throw new Error('AC-3 系要按字节流喂（decode）')
      return packet(frame)
    },
    flush: () => (opts.codec === 'ac3' ? feed(null, true) : []),
    reset: () => {
      if (!ex.dec_reset(d)) throw new Error('dolby wasm 重置失败')
    },
    get errors() {
      return ex.dec_errors(d)
    },
    close: () => {
      if (closed) return
      closed = true
      ex.dec_close(d)
    }
  }
}
