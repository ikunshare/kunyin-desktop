/**
 * Audio Vivid（AVS3-P3，MP4 里的 av3a 音轨）软解：MOLAN-AV3A 编成的 wasm（native/av3a-wasm）。
 *
 * MOLAN-AV3A 是 UWA 发布的 AVS3-P3 参考解码器（AVS3A_RMv3.3.1，华为）的库化封装，神经网络后处理模型
 * 已经内嵌，不要任何外部数据文件。网易「臻音全景声」实测是 44.1kHz、12 声道（7.1.4 声床）、832kbps。
 *
 * 输出直接是立体声：解码器吐的是声床各声道（参考解码器自己不渲染），这里按帧头里的声道配置下混，
 * 交给 dolbyStream 时已经是两声道，跟 AC-3 系「解码器内部下混」的接法一致。
 *
 * - 下混：主声道直送同侧，中置与其余（环绕、后环绕、天空）同侧 −3dB，LFE 不进（与 dolbyStream 的
 *   toStereo 同一套约定），再按功率归一（7.1.4 是 −5.4dB）。没用 baka-av3a 那张「声床 → 立体声」矩阵：
 *   它把侧环绕反相混进对侧（矩阵环绕编码的做法），给耳机听会发虚、单声道兼容也差。
 *   网易那首 7.1.4 实测归一后峰值 −0.9dBFS、RMS −15.5dBFS，一个样本都没过满幅；
 *   以防万一，0.9 以上走一段无状态的软拐点（tanh），不引入时延、seek 前后也一致。
 * - 只认声床（单声道 / 立体声 / 5.1 / 7.1 / 5.1.2 / 5.1.4 / 7.1.2 / 7.1.4）。对象、声床+对象、HOA
 *   要靠元数据或球谐解码才能放到正确位置，手头没有真实样本验证，宁可明确报错也不瞎混。
 * - 坏帧（CRC 错等）不抛：计进 errors、这一包不出声，由 dolbyStream 按样本表补静音对齐时间轴。
 *
 * 跟 dolbyDecoder.ts 一样不 import core/logger（会拉进 electron），tools/av3aDecoder.test.mjs 纯 Node 跑。
 */
import { AV3A_WASM_BASE64 } from './av3aWasmBinary'
import type { DolbyDecoder, PcmChunk } from './dolbyDecoder'
import { wasiImports } from './wasi'

// ============ 帧头 ============

/** 帧头里的编码配置（只解到下混要用的那几个字段） */
export type Av3aLayout =
  | { kind: 'bed'; config: number }
  | { kind: 'objects'; count: number }
  | { kind: 'bed+objects'; config: number; objects: number }
  | { kind: 'hoa'; order: number }

/**
 * 解 AV3A 帧头：sync 0xFFF(12) | codec_id=2(4) | 辅助数据(1) | nn_type(3) | coding_profile(3)
 * | 采样率序号(4) | crc 高 8 位(8)，随后按 coding_profile：0 声床配置(7)；1 声床类型(2) + …；
 * 2 HOA 阶数−1(4)。不是 AV3A 帧（同步字不对、截断）返回 null。
 */
export function parseAv3aHeader(frame: Uint8Array): Av3aLayout | null {
  let bit = 0
  const read = (n: number): number => {
    let v = 0
    for (let i = 0; i < n; i++, bit++) {
      const byte = frame[bit >> 3]
      if (byte === undefined) throw new RangeError('truncated')
      v = (v << 1) | ((byte >> (7 - (bit & 7))) & 1)
    }
    return v
  }
  try {
    if (read(12) !== 0xfff || read(4) !== 2) return null
    read(1 + 3)
    const coding = read(3)
    read(4 + 8)
    if (coding === 0) return { kind: 'bed', config: read(7) }
    if (coding === 1) {
      const bedType = read(2)
      if (bedType === 0) return { kind: 'objects', count: read(7) + 1 }
      if (bedType === 1) {
        const config = read(7)
        read(4)
        return { kind: 'bed+objects', config, objects: read(7) + 1 }
      }
      return null
    }
    if (coding === 2) return { kind: 'hoa', order: read(4) + 1 }
    return null
  } catch {
    return null
  }
}

// ============ 下混 ============

/**
 * 各声床配置的声道去向，按解码器输出顺序（AVS3-P3 的声道配置序号）：
 * 'L' / 'R' 直送同侧；'C' 两侧各 −3dB；'l' / 'r' 环绕与天空声道，同侧 −3dB；'-' LFE 不进下混；
 * 'M' 单声道，两侧原样。
 */
const BED_ROLES: Readonly<Record<number, string>> = {
  0: 'M',
  1: 'LR',
  2: 'LRC-lr', // 5.1：L R C LFE Ls Rs
  3: 'LRC-lrlr', // 7.1：L R C LFE Lss Rss Lrs Rrs
  7: 'LRC-lrlr', // 5.1.2：L R C LFE Ls Rs Ltf Rtf
  8: 'LRC-lrlrlr', // 5.1.4：L R C LFE Ls Rs Ltf Rtf Ltr Rtr
  9: 'LRC-lrlrlr', // 7.1.2：L R C LFE Lss Rss Lrs Rrs Ltf Rtf
  10: 'LRC-lrlrlrlr' // 7.1.4：L R C LFE Lss Rss Lrs Rrs Ltf Rtf Ltr Rtr
}

export interface StereoMatrix {
  /** 每个输入声道进左 / 右的增益（已含归一） */
  left: Float32Array
  right: Float32Array
}

/** 某个声床配置的下混矩阵；不支持的配置返回 null */
export function stereoMatrix(config: number): StereoMatrix | null {
  const roles = BED_ROLES[config]
  if (!roles) return null
  const n = roles.length
  const left = new Float32Array(n)
  const right = new Float32Array(n)
  const H = Math.SQRT1_2
  for (let c = 0; c < n; c++) {
    switch (roles[c]) {
      case 'M':
        left[c] = right[c] = 1
        break
      case 'L':
        left[c] = 1
        break
      case 'R':
        right[c] = 1
        break
      case 'C':
        left[c] = right[c] = H
        break
      case 'l':
        left[c] = H
        break
      case 'r':
        right[c] = H
        break
    }
  }
  // 按功率归一（各声道近似不相关）：单声道 / 立体声不变，5.1 −3dB，7.1.4 −5.4dB
  let power = 0
  for (let c = 0; c < n; c++) power += left[c] * left[c]
  const norm = roles === 'M' ? 1 : 1 / Math.sqrt(power)
  for (let c = 0; c < n; c++) {
    left[c] *= norm
    right[c] *= norm
  }
  return { left, right }
}

/** 0.9 以上的软拐点：一阶导连续、渐近 1，无状态 */
const KNEE = 0.9
function softClip(x: number): number {
  const a = x < 0 ? -x : x
  if (a <= KNEE) return x
  const y = KNEE + (1 - KNEE) * Math.tanh((a - KNEE) / (1 - KNEE))
  return x < 0 ? -y : y
}

/** 交错 s16 多声道 → 交错 float 立体声 */
export function downmixToStereo(
  pcm: Int16Array,
  channels: number,
  matrix: StereoMatrix
): Float32Array {
  const frames = Math.floor(pcm.length / channels)
  const out = new Float32Array(frames * 2)
  const { left, right } = matrix
  const scale = 1 / 32768
  for (let f = 0, i = 0; f < frames; f++, i += channels) {
    let l = 0
    let r = 0
    for (let c = 0; c < channels; c++) {
      const v = pcm[i + c]
      l += left[c] * v
      r += right[c] * v
    }
    out[f * 2] = softClip(l * scale)
    out[f * 2 + 1] = softClip(r * scale)
  }
  return out
}

/** 描述用（日志 / 报错） */
export function describeLayout(layout: Av3aLayout): string {
  switch (layout.kind) {
    case 'bed':
      return `声床配置 ${layout.config}`
    case 'objects':
      return `${layout.count} 个对象`
    case 'bed+objects':
      return `声床配置 ${layout.config} + ${layout.objects} 个对象`
    case 'hoa':
      return `${layout.order} 阶 HOA`
  }
}

// ============ wasm ============

interface Av3aExports {
  memory: WebAssembly.Memory
  _initialize(): void
  av3a_open(): number
  av3a_close(h: number): void
  av3a_in_ptr(h: number, len: number): number
  av3a_packet(h: number, len: number): number
  av3a_out_ptr(h: number): number
  av3a_channels(h: number): number
  av3a_sample_rate(h: number): number
  av3a_reset(h: number): void
}

let cachedModule: WebAssembly.Module | null | undefined
let failReason = ''

function getModule(): WebAssembly.Module | null {
  if (cachedModule !== undefined) return cachedModule
  try {
    cachedModule = new WebAssembly.Module(Buffer.from(AV3A_WASM_BASE64, 'base64'))
  } catch (e) {
    cachedModule = null
    failReason = e instanceof Error ? e.message : String(e)
  }
  return cachedModule
}

/** 诊断用：Audio Vivid 软解是否可用；不可用时给出原因 */
export function av3aWasmStatus(): { available: boolean; reason?: string } {
  return getModule() ? { available: true } : { available: false, reason: failReason || '未知原因' }
}

/** 码流不是能下混的声床格式 */
export class Av3aUnsupportedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'Av3aUnsupportedError'
  }
}

/**
 * 新建一路解码器；wasm 不可用返回 null。每路一个实例（参考解码器有模块级状态），
 * 丢掉实例整块回收。接口与 dolbyDecoder 的按包模式一致：packet() 一次喂一个 MP4 样本。
 */
export function createAv3aDecoder(): DolbyDecoder | null {
  const mod = getModule()
  if (!mod) return null
  let ex: Av3aExports
  try {
    const instance = new WebAssembly.Instance(mod, {
      wasi_snapshot_preview1: wasiImports(() => ex.memory, 'av3a')
    })
    ex = instance.exports as unknown as Av3aExports
    ex._initialize()
  } catch (e) {
    failReason = e instanceof Error ? e.message : String(e)
    return null
  }
  const h = ex.av3a_open()
  if (!h) return null
  let closed = false
  let errors = 0
  let matrix: StereoMatrix | null = null
  let matrixChannels = 0

  /** 按这一帧的帧头定下混矩阵；声道数变了（换了节目）才重算 */
  const matrixFor = (frame: Uint8Array, channels: number): StereoMatrix => {
    if (matrix && matrixChannels === channels) return matrix
    const layout = parseAv3aHeader(frame)
    if (!layout) throw new Av3aUnsupportedError('Audio Vivid 帧头无法解析')
    const m = layout.kind === 'bed' ? stereoMatrix(layout.config) : null
    if (!m) throw new Av3aUnsupportedError(`暂不支持的 Audio Vivid 格式：${describeLayout(layout)}`)
    if (m.left.length !== channels) {
      throw new Av3aUnsupportedError(
        `声道数与声床配置不符：${channels} / ${describeLayout(layout)}`
      )
    }
    matrix = m
    matrixChannels = channels
    return m
  }

  const packet = (frame: Uint8Array): PcmChunk[] => {
    if (closed) throw new Error('解码器已关闭')
    if (!frame.length) return []
    const ptr = ex.av3a_in_ptr(h, frame.length)
    if (!ptr) throw new Error('av3a wasm 分配输入缓冲失败')
    new Uint8Array(ex.memory.buffer, ptr, frame.length).set(frame)
    const frames = ex.av3a_packet(h, frame.length)
    if (frames <= 0) {
      if (frames < 0) errors++
      return []
    }
    const channels = ex.av3a_channels(h)
    const m = matrixFor(frame, channels)
    // memory 可能 grow 过，视图现建
    const pcm = new Int16Array(ex.memory.buffer, ex.av3a_out_ptr(h), frames * channels)
    const data = downmixToStereo(pcm, channels, m)
    return [{ channels: 2, sampleRate: ex.av3a_sample_rate(h), frames, data }]
  }

  return {
    codec: 'av3a',
    decode: () => {
      throw new Error('AV3A 要按帧喂（packet）')
    },
    packet,
    // 参考解码器一帧进一帧出，没有攒着的尾巴
    flush: () => [],
    reset: () => {
      // 重建上游解码器实例；libc rand() 的状态不跟着归位，之后与新开一路只差噪声填充那一层
      ex.av3a_reset(h)
    },
    get errors() {
      return errors
    },
    close: () => {
      if (closed) return
      closed = true
      ex.av3a_close(h)
    }
  }
}
