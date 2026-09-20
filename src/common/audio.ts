/**
 * 音效（均衡器 / 环境混响 / 3D 环绕 / 升降调）的共享常量。
 *
 * 频点、Q 值、各预设的增益曲线、每条脉冲响应的干湿增益全部逐值移植自
 * lx-music-desktop（Apache-2.0, © lyswhut）`renderer/plugins/player/index.ts` 的
 * `freqs` / `freqsPreset` / `convolutions`——这些数字是调出来的听感，不要凭感觉改。
 *
 * 与 LX 的差异只在形状：LX 用扁平点分 key（`player.soundEffect.biquadFilter.hz31`），
 * 这里按本仓库惯例收成嵌套对象 + 数组，索引与 `EQ_FREQS` 一一对应。
 */

/** 均衡器的 10 个频点（Hz，低→高）。数组顺序即 `soundEffect.eq` 的索引顺序。 */
export const EQ_FREQS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const

/** 每段的增益上下限（dB）。与 LX 的滑杆范围一致。 */
export const EQ_GAIN_LIMIT = 15

/**
 * peaking 滤波器的 Q 值。10 段覆盖 31Hz~16kHz 时 1.4 的带宽刚好相邻段略有重叠，
 * 既不会在段间留下凹陷，也不至于互相打架。
 */
export const EQ_Q = 1.4

export interface EqPreset {
  id: string
  name: string
  /** 各频点增益（dB），长度与 EQ_FREQS 相同 */
  gains: readonly number[]
}

/** 均衡器预设（名称取 LX 简体中文语言包）。 */
export const EQ_PRESETS: readonly EqPreset[] = [
  { id: 'pop', name: '流行', gains: [6, 5, -3, -2, 5, 4, -4, -3, 6, 4] },
  { id: 'dance', name: '舞曲', gains: [4, 3, -4, -6, 0, 0, 3, 4, 4, 5] },
  { id: 'rock', name: '摇滚', gains: [7, 6, 2, 1, -3, -4, 2, 1, 4, 5] },
  { id: 'classical', name: '古典', gains: [6, 7, 1, 2, -1, 1, -4, -6, -7, -8] },
  { id: 'vocal', name: '人声', gains: [-5, -6, -4, -3, 3, 4, 5, 4, -3, -3] },
  { id: 'slow', name: '慢歌', gains: [5, 4, 2, 0, -2, 0, 3, 6, 7, 8] },
  { id: 'electronic', name: '电子乐', gains: [6, 5, 0, -5, -4, 0, 6, 8, 8, 7] },
  { id: 'subwoofer', name: '重低音', gains: [8, 7, 5, 4, 0, 0, 0, 0, 0, 0] },
  { id: 'soft', name: '柔和', gains: [-5, -5, -4, -4, 3, 2, 4, 4, 0, 0] }
] as const

export interface ConvolutionPreset {
  id: string
  name: string
  /** 脉冲响应文件名（renderer/src/audio/filters/ 下） */
  file: string
  /** 干声增益 ×10（对应设置里的 convolutionMainGain 默认值） */
  mainGain: number
  /** 湿声（混响）增益 ×10 */
  sendGain: number
}

/**
 * 环境混响预设。`mainGain`/`sendGain` 存的是 ×10 的整数，和滑杆刻度一致
 * （0..50 → 实际 0..5），用的时候除以 10。
 */
export const CONVOLUTION_PRESETS: readonly ConvolutionPreset[] = [
  { id: 'telephone', name: '电话', file: 'filter-telephone.wav', mainGain: 0, sendGain: 30 },
  { id: 's2_r4_bd', name: '教堂', file: 's2_r4_bd.wav', mainGain: 18, sendGain: 9 },
  { id: 'bright_hall', name: '大厅', file: 'bright-hall.wav', mainGain: 8, sendGain: 24 },
  {
    id: 'cinema_diningroom',
    name: '电影院',
    file: 'cinema-diningroom.wav',
    mainGain: 6,
    sendGain: 23
  },
  {
    id: 'dining_living_true_stereo',
    name: '餐厅',
    file: 'dining-living-true-stereo.wav',
    mainGain: 6,
    sendGain: 18
  },
  {
    id: 'living_bedroom_leveled',
    name: '卫生间',
    file: 'living-bedroom-leveled.wav',
    mainGain: 6,
    sendGain: 21
  },
  { id: 'spreader50_65ms', name: '室内', file: 'spreader50-65ms.wav', mainGain: 10, sendGain: 25 },
  { id: 's3_r1_bd', name: '立体声', file: 's3_r1_bd.wav', mainGain: 18, sendGain: 8 },
  { id: 'matrix_1', name: '矩阵混响（1）', file: 'matrix-reverb1.wav', mainGain: 15, sendGain: 9 },
  { id: 'matrix_2', name: '矩阵混响（2）', file: 'matrix-reverb2.wav', mainGain: 13, sendGain: 10 },
  {
    id: 'cardiod_35_10_spread',
    name: '心形扩散',
    file: 'cardiod-35-10-spread.wav',
    mainGain: 18,
    sendGain: 6
  },
  {
    id: 'tim_omni_35_10_magnetic',
    name: '磁性立体声',
    file: 'tim-omni-35-10-magnetic.wav',
    mainGain: 10,
    sendGain: 2
  },
  {
    id: 'feedback_spring',
    name: '反馈弹簧',
    file: 'feedback-spring.wav',
    mainGain: 18,
    sendGain: 8
  }
] as const

/** 混响两个增益滑杆的刻度范围（×10） */
export const CONVOLUTION_GAIN_MAX = 50

/** 3D 环绕：声源距离刻度（×10，1..30 → 0.1..3） */
export const PANNER_RADIUS_RANGE = { min: 1, max: 30 } as const
/** 3D 环绕：环绕速度刻度（LX 里实际周期 = 2 × speed/10 毫秒每度） */
export const PANNER_SPEED_RANGE = { min: 1, max: 50 } as const

/** 升降调：pitchFactor 的范围（1 = 原调；0.5 低八度，1.5 约高七个半音） */
export const PITCH_FACTOR_RANGE = { min: 0.5, max: 1.5 } as const

/** 半音 → pitchFactor。12 个半音是一个八度，故 2^(n/12)。 */
export function semitonesToPitchFactor(semitones: number): number {
  return Number((2 ** (semitones / 12)).toFixed(2))
}

/** 与 EQ_FREQS 等长的全零增益（关闭均衡器时的取值） */
export function flatEqGains(): number[] {
  return EQ_FREQS.map(() => 0)
}

/** 把任意长度/越界的 EQ 数组规整成合法值（旧配置、手改配置文件都可能不合法） */
export function normalizeEqGains(gains: readonly number[] | undefined): number[] {
  return EQ_FREQS.map((_, i) => {
    const v = Number(gains?.[i])
    if (!Number.isFinite(v)) return 0
    return Math.max(-EQ_GAIN_LIMIT, Math.min(EQ_GAIN_LIMIT, Math.round(v)))
  })
}

/** 均衡器是否处于「全平」状态（全平时不必接入滤波链） */
export function isFlatEq(gains: readonly number[] | undefined): boolean {
  return normalizeEqGains(gains).every((v) => v === 0)
}
