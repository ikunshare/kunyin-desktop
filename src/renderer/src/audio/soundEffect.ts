/**
 * 音效处理图（均衡器 / 环境混响 / 3D 环绕 / 升降调 / 最大声道输出）。
 *
 * 结构逐条移植自 lx-music-desktop（Apache-2.0, © lyswhut）`renderer/plugins/player/index.ts`：
 *
 * ```
 * <audio> ─ source ─ analyser ─ eq[31Hz…16kHz] ─┬─(pitchShifter)─┬─ convolver ─ wetGain ─┐
 *                                                                └─ dryGain ─────────────┴─ compressor ─ panner ─ outGain ─ destination
 * ```
 *
 * **懒建图**是这里最重要的约定：`createMediaElementSource` 一旦创建就无法解除，之后
 * `<audio>` 的声音只能经 AudioContext 出去。所以只有用户真的开了某项音效才建图——
 * 全默认值时播放链路与没有这个功能时**完全一致**（也就不会被自动播放策略卡成静音：
 * AudioContext 在没有用户手势前是 suspended，而那时若声音只能走图，就会哑掉）。
 *
 * 与 LX 的一处实质改进：LX 的界面写着「音效设置与自定义音频输出设备冲突，目前暂无法解决」，
 * 它的做法是启用音效时把输出设备强制重置为默认。实际上图建起来之后，决定去哪个设备的是
 * AudioContext 而不是 <audio>，而 `AudioContext.setSinkId` 在安全上下文里是可用的
 * （Electron 44 / Chrome 152 实测：secure context 下有，data: 页面里没有）。
 * 因此这里把设备切换统一收口到 `setSinkId()`，建图后自动改用 context 那一路，两者不再冲突。
 */
import {
  CONVOLUTION_PRESETS,
  EQ_FREQS,
  EQ_Q,
  PITCH_FACTOR_RANGE,
  isFlatEq,
  normalizeEqGains,
  type AppSettings
} from '@common'

type SoundEffectSettings = AppSettings['player']['soundEffect']

/** 混响脉冲响应：Vite 在构建期把 wav 收进 assets，这里按文件名取 URL */
const FILTER_URLS = import.meta.glob('./filters/*.wav', {
  eager: true,
  query: '?url',
  import: 'default'
}) as Record<string, string>

function filterUrl(file: string): string | null {
  return FILTER_URLS['./filters/' + file] ?? null
}

let audioEl: HTMLAudioElement | null = null
let ctx: AudioContext | null = null
let source: MediaElementAudioSourceNode | null = null
let analyser: AnalyserNode | null = null
let eqFilters: BiquadFilterNode[] = []
let convolver: ConvolverNode | null = null
/** 干声增益（LX 的 convolverSourceGainNode） */
let dryGain: GainNode | null = null
/** 湿声增益（LX 的 convolverOutputGainNode） */
let wetGain: GainNode | null = null
let panner: PannerNode | null = null
let outGain: GainNode | null = null
/** 建图时记下的默认输出声道数，关掉「最大声道输出」时要还原成它 */
let defaultChannelCount = 2
/** 当前选中的输出设备 id（'default' = 系统默认）。建图后要补设到 context 上。 */
let sinkId = 'default'

/** 把音频元素交给本模块（只记引用，不建图） */
export function attachAudioElement(el: HTMLAudioElement): void {
  audioEl = el
}

/** 处理图是否已经建起来（建了就撤不掉，见文件头注释） */
export function isSoundEffectActive(): boolean {
  return ctx != null
}

/** 处理图里的分析器；没建图时为 null（此时频谱走播放 store 里的 captureStream 旁路） */
export function getEffectAnalyser(): AnalyserNode | null {
  return analyser
}

function lastEqFilter(): AudioNode {
  return eqFilters[eqFilters.length - 1]
}

/**
 * 建图（幂等）。失败返回 false —— 跨源音频拿不到 MediaElementSource、
 * 或浏览器不给 AudioContext 时，调用方应当保持「无音效」状态继续播放。
 */
function ensureGraph(): boolean {
  if (ctx) return true
  if (!audioEl) return false
  try {
    // latencyHint: 'playback' 换取更大的缓冲：音乐播放不需要低延迟，缓冲大了卡顿少
    const context = new AudioContext({ latencyHint: 'playback' })
    defaultChannelCount = context.destination.channelCount

    const src = context.createMediaElementSource(audioEl)
    const an = context.createAnalyser()
    an.fftSize = 256
    an.smoothingTimeConstant = 0.76
    an.minDecibels = -90
    an.maxDecibels = -18

    const filters = EQ_FREQS.map((hz) => {
      const f = context.createBiquadFilter()
      f.type = 'peaking'
      f.frequency.value = hz
      f.Q.value = EQ_Q
      f.gain.value = 0
      return f
    })
    for (let i = 1; i < filters.length; i++) filters[i - 1].connect(filters[i])

    const dry = context.createGain()
    const wet = context.createGain()
    const comp = context.createDynamicsCompressor()
    const conv = context.createConvolver()
    conv.connect(wet)
    dry.connect(comp)
    wet.connect(comp)

    const pan = context.createPanner()
    const out = context.createGain()

    src.connect(an)
    an.connect(filters[0])
    filters[filters.length - 1].connect(dry)
    filters[filters.length - 1].connect(conv)
    comp.connect(pan)
    pan.connect(out)
    out.connect(context.destination)

    // 没有混响时干声直通、湿声闭掉（conv.buffer 为 null 时本来就只出静音，双保险）
    dry.gain.value = 1
    wet.gain.value = 0

    ctx = context
    source = src
    analyser = an
    eqFilters = filters
    convolver = conv
    dryGain = dry
    wetGain = wet
    panner = pan
    outGain = out

    // 自动播放策略：没有用户手势时 AudioContext 是 suspended，此时图是哑的。
    // 播放真正开始时补一次 resume（对齐 LX 的做法）。
    audioEl.addEventListener('playing', resumeContext)
    void applySinkId()
    return true
  } catch (e) {
    console.warn('[soundEffect] 无法建立音效处理图', e)
    return false
  }
}

function resumeContext(): void {
  if (ctx?.state === 'suspended') void ctx.resume().catch(() => {})
}

// ============ 输出设备 ============

/**
 * 切换音频输出设备。建图前走 `<audio>.setSinkId`，建图后必须走 `AudioContext.setSinkId`——
 * 声音这时已经不从元素直出了，设在元素上不起作用（这正是 LX 那条「冲突」提示的由来）。
 */
export async function setSinkId(id: string): Promise<void> {
  sinkId = id || 'default'
  if (ctx) {
    await applySinkId()
    return
  }
  if (!audioEl?.setSinkId) throw new Error('当前系统不支持选择输出设备')
  await audioEl.setSinkId(sinkId)
}

async function applySinkId(): Promise<void> {
  const context = ctx as (AudioContext & { setSinkId?: (id: string) => Promise<void> }) | null
  if (!context?.setSinkId) return
  // AudioContext 用空串表示「系统默认」，与我们存的 'default' 不是一个写法
  await context.setSinkId(sinkId === 'default' ? '' : sinkId)
}

// ============ 最大声道输出 ============

/**
 * 最大声道输出：把 destination 的声道数顶到设备支持的上限，并让上游按 'max' 自适应。
 *
 * 立体声设备上 maxChannelCount 就是 2，开了也没有变化；接 5.1/7.1 声卡或 HDMI 时才有意义。
 * 设备切换后上限会变，所以每次设备变化都要重设一遍（LX 也是这么处理的）。
 */
export function setMaxOutputChannels(enable: boolean): void {
  if (!ctx) return
  const dest = ctx.destination
  if (enable) {
    dest.channelCountMode = 'max'
    dest.channelCount = dest.maxChannelCount
  } else if (dest.channelCountMode !== 'explicit') {
    dest.channelCount = defaultChannelCount
    dest.channelCountMode = 'explicit'
  }
}

// ============ 均衡器 ============

function applyEq(gains: readonly number[]): void {
  const values = normalizeEqGains(gains)
  eqFilters.forEach((filter, i) => {
    if (filter.gain.value !== values[i]) filter.gain.value = values[i]
  })
}

// ============ 环境混响 ============

const bufferCache = new Map<string, AudioBuffer>()
/** 正在应用的混响 id；异步解码回来时用它判断有没有被后来的选择顶掉 */
let convolutionToken = ''

async function loadImpulseResponse(file: string): Promise<AudioBuffer | null> {
  const cached = bufferCache.get(file)
  if (cached) return cached
  const url = filterUrl(file)
  if (!url || !ctx) return null
  try {
    const data = await fetch(url).then((r) => r.arrayBuffer())
    const buffer = await ctx.decodeAudioData(data)
    bufferCache.set(file, buffer)
    return buffer
  } catch (e) {
    console.warn('[soundEffect] 混响脉冲响应加载失败', file, e)
    return null
  }
}

function applyConvolutionGains(mainGain: number, sendGain: number): void {
  if (!dryGain || !wetGain) return
  // 设置里存的是 ×10 的刻度值（与滑杆一致），节点上要的是实际增益
  dryGain.gain.value = mainGain / 10
  wetGain.gain.value = sendGain / 10
}

async function applyConvolution(id: string, mainGain: number, sendGain: number): Promise<void> {
  if (!convolver || !dryGain || !wetGain) return
  convolutionToken = id
  if (!id) {
    convolver.buffer = null
    dryGain.gain.value = 1
    wetGain.gain.value = 0
    return
  }
  const preset = CONVOLUTION_PRESETS.find((p) => p.id === id)
  if (!preset) return
  const buffer = await loadImpulseResponse(preset.file)
  // 解码是异步的，期间用户可能已经换了别的混响（或关掉了）
  if (convolutionToken !== id || !convolver) return
  convolver.buffer = buffer
  if (buffer) applyConvolutionGains(mainGain, sendGain)
}

// ============ 3D 环绕 ============

const pannerState = {
  radius: 0.5,
  /** 每 10ms 走 1 度，speed 越大转得越慢（与 LX 的 `speed * 10` 毫秒一致） */
  speed: 2.5,
  degree: 0,
  timer: null as ReturnType<typeof setInterval> | null
}

function movePanner(): void {
  if (!panner) return
  const rad = (pannerState.degree * Math.PI) / 180
  panner.positionX.value = Math.sin(rad) * pannerState.radius
  panner.positionY.value = Math.cos(rad) * pannerState.radius
  panner.positionZ.value = Math.cos(rad) * pannerState.radius
}

function startPanner(): void {
  stopPannerTimer()
  pannerState.timer = setInterval(() => {
    pannerState.degree = (pannerState.degree + 1) % 360
    movePanner()
  }, pannerState.speed * 10)
}

function stopPannerTimer(): void {
  if (!pannerState.timer) return
  clearInterval(pannerState.timer)
  pannerState.timer = null
  pannerState.degree = 0
}

function stopPanner(): void {
  stopPannerTimer()
  if (!panner) return
  panner.positionX.value = 0
  panner.positionY.value = 0
  panner.positionZ.value = 0
}

// ============ 升降调（AudioWorklet） ============

let pitchNode: AudioWorkletNode | null = null
let pitchParam: AudioParam | null = null
let pitchStatus: 'none' | 'loading' | 'ready' | 'connected' = 'none'
let pitchWanted = 1

/**
 * 变调接上之后 worklet 会一直跑；LX 的做法是暂停/缓冲时把链路摘开，避免处理任务堆积
 * （堆积的表现是恢复播放后声音发怪，得暂停一会儿等它消化完）。这里照搬。
 */
let chainConnected = true
function connectChain(): void {
  if (chainConnected || !analyser) return
  analyser.connect(eqFilters[0])
  chainConnected = true
}
function disconnectChain(): void {
  if (!chainConnected || !analyser) return
  analyser.disconnect()
  chainConnected = false
}

function connectPitchNode(): void {
  if (!pitchNode || !convolver || !dryGain || !audioEl) return
  audioEl.addEventListener('playing', connectChain)
  audioEl.addEventListener('pause', disconnectChain)
  audioEl.addEventListener('waiting', disconnectChain)
  audioEl.addEventListener('emptied', disconnectChain)
  if (audioEl.paused) disconnectChain()

  const last = lastEqFilter()
  last.disconnect()
  last.connect(pitchNode)
  pitchNode.connect(convolver)
  pitchNode.connect(dryGain)
  pitchStatus = 'connected'
  if (pitchParam) pitchParam.value = pitchWanted
}

function disconnectPitchNode(): void {
  if (!convolver || !dryGain || !audioEl) return
  const last = lastEqFilter()
  last.disconnect()
  last.connect(convolver)
  last.connect(dryGain)
  pitchNode?.disconnect()
  pitchStatus = 'ready'

  audioEl.removeEventListener('playing', connectChain)
  audioEl.removeEventListener('pause', disconnectChain)
  audioEl.removeEventListener('waiting', disconnectChain)
  audioEl.removeEventListener('emptied', disconnectChain)
  connectChain()
}

async function loadPitchNode(): Promise<void> {
  if (!ctx) return
  pitchStatus = 'loading'
  try {
    const url = (await import('./pitch-shifter.worklet.js?url')).default
    await ctx.audioWorklet.addModule(url)
    // outputChannelCount 必须显式给：worklet 默认按输入推断，遇到单声道源会输出单声道，
    // 接进后面的立体声链路就只剩一边有声（上游 phaze 的 issue #26 记了这个坑）
    pitchNode = new AudioWorkletNode(ctx, 'phase-vocoder-processor', {
      outputChannelCount: [2]
    })
    pitchParam = pitchNode.parameters.get('pitchFactor') ?? null
    pitchStatus = 'ready'
    if (pitchWanted !== 1) connectPitchNode()
  } catch (e) {
    console.warn('[soundEffect] 变调处理器加载失败', e)
    pitchStatus = 'none'
  }
}

function applyPitch(factor: number): void {
  const value = Math.max(
    PITCH_FACTOR_RANGE.min,
    Math.min(PITCH_FACTOR_RANGE.max, Number(factor) || 1)
  )
  pitchWanted = value
  switch (pitchStatus) {
    case 'loading':
      break
    case 'none':
      if (value !== 1) void loadPitchNode()
      break
    case 'ready':
      if (value !== 1) connectPitchNode()
      break
    case 'connected':
      if (value === 1) disconnectPitchNode()
      else if (pitchParam) pitchParam.value = value
      break
  }
}

// ============ 对外：按设置套用 ============

/** 这份设置是否需要处理图。全是默认值时返回 false —— 那就一个节点都不建。 */
export function needsGraph(s: SoundEffectSettings): boolean {
  return (
    !isFlatEq(s.eq) ||
    s.convolution !== '' ||
    s.pannerEnabled ||
    s.pitchFactor !== 1 ||
    s.maxOutputChannels
  )
}

/**
 * 按设置套用全部音效。设置页每次改动都调它（幂等）。
 * @returns 处理图当前是否生效
 */
export function applySoundEffect(s: SoundEffectSettings): boolean {
  if (!ctx && !needsGraph(s)) return false
  if (!ensureGraph()) return false

  applyEq(s.eq)
  void applyConvolution(s.convolution, s.convolutionMainGain, s.convolutionSendGain)
  if (s.convolution) applyConvolutionGains(s.convolutionMainGain, s.convolutionSendGain)

  pannerState.radius = s.pannerRadius / 10
  pannerState.speed = s.pannerSpeed / 10
  if (s.pannerEnabled) startPanner()
  else stopPanner()

  applyPitch(s.pitchFactor)
  setMaxOutputChannels(s.maxOutputChannels)
  resumeContext()
  return true
}

/**
 * 拖滑杆时的实时试听：只作用到已建好的处理图，不写设置（设置每改一次就要落一次盘）。
 * 还没建图时什么也不做——等松手那一下 `applySoundEffect` 会把图建起来。
 */
export function previewSoundEffect(s: SoundEffectSettings): void {
  if (!ctx) return
  applySoundEffect(s)
}

/** 输出设备列表变化时调用：多声道上限可能跟着变，得按当前设置重设一遍 */
export function refreshMaxOutputChannels(enable: boolean): void {
  if (!ctx) return
  setMaxOutputChannels(enable)
  void applySinkId()
}

/** 诊断/调试用：当前处理图状态 */
export function soundEffectStatus(): {
  active: boolean
  state: string
  channelCount: number
  maxChannelCount: number
  pitch: string
} {
  return {
    active: ctx != null,
    state: ctx?.state ?? 'none',
    channelCount: ctx?.destination.channelCount ?? 0,
    maxChannelCount: ctx?.destination.maxChannelCount ?? 0,
    pitch: pitchStatus
  }
}

/** 仅供测试/probe：暴露内部节点，业务代码不要用 */
export function __internals(): {
  ctx: AudioContext | null
  source: MediaElementAudioSourceNode | null
  eq: BiquadFilterNode[]
  convolver: ConvolverNode | null
  outGain: GainNode | null
} {
  return { ctx, source, eq: eqFilters, convolver, outGain }
}
