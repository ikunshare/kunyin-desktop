import { createLogger } from '../utils/logger'
const log = createLogger('player')
import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { PlaybackQueue } from '../utils/playbackQueue'
import { useAudioDevices } from '../composables/useAudioDevices'
import {
  applySoundEffect,
  attachAudioElement,
  getEffectAnalyser,
  isSoundEffectActive
} from '../audio/soundEffect'
import type { AudioStreamResult, MusicItem, MusicSource, PlayMode, QualityId } from '@common'
import {
  DEFAULT_SETTINGS,
  blockedQualityIds,
  getMusicItemKey,
  qualityFallbackOrder,
  qualityUpgradeOrder
} from '@common'
import { useSettingsStore } from './settings'

/**
 * 播放器状态 + 真实 <audio> 驱动。
 * 播放地址经主进程自定义协议 kunyin:// 供 <audio>，规避 CSP 与 CDN 鉴权。
 * currentTime/duration 单位为毫秒（与歌词引擎、UI 一致）。
 */
const SPECTRUM_BAR_COUNT = 20

/**
 * 播放队列的来源（哪个列表/试听/单曲）。各列表页据此判断「当前正在播放的队列属于哪里」，
 * 用于展示正在播放的列表标记、提示用户浏览的列表与播放队列不一致。
 * - local   本地歌单（含系统列表：我的收藏/试听列表）
 * - platform 在线歌单/专辑/歌手（id 统一为 `source:id`）
 * - trial   试听列表（搜索点单曲）
 * - single  单曲临时队列（重复歌曲弹窗等）
 * - search  搜索结果多选后「播放」的临时队列（name 为关键词）
 */
export interface QueueSource {
  kind: 'local' | 'platform' | 'trial' | 'single' | 'search'
  id?: string
  name?: string
}

/**
 * 播放事件（供听歌上报等旁路逻辑订阅，不参与播放控制）：
 * - loaded：某曲目加载完成并开始播放/待播
 * - ended：曲目自然播完（切歌前触发）
 * - seek：用户拖动进度
 */
export type PlayerTrackEvent =
  | { type: 'loaded'; item: MusicItem }
  | { type: 'ended'; item: MusicItem }
  | { type: 'seek'; item: MusicItem; positionMs: number }

/** 把 MediaError 翻成人话（网络类错误多半是代理不可用，直接点出来省得用户猜） */
function describeMediaError(err: MediaError | null): string {
  switch (err?.code) {
    case MediaError.MEDIA_ERR_NETWORK:
      return '网络错误，播放中断（若开了代理请检查代理是否可用）'
    case MediaError.MEDIA_ERR_DECODE:
      return '音频解码失败'
    case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
      return '无法载入音频（直链失效或代理不可用）'
    case MediaError.MEDIA_ERR_ABORTED:
      return '播放已取消'
    default:
      return '播放失败'
  }
}

export const usePlayerStore = defineStore('player', () => {
  const current = ref<MusicItem | null>(null)
  const queue = ref<MusicItem[]>([])
  const index = ref(-1)
  /** 当前播放队列的来源列表（null 表示队列无来源，如恢复旧存档） */
  const queueSource = ref<QueueSource | null>(null)
  const playing = ref(false)
  /** 播放模式（初值为占位，真实值由 hydrateFromSettings 在设置到位后灌入） */
  const playMode = ref<PlayMode>('listLoop')
  const currentTime = ref(0)
  const duration = ref(0)
  const loading = ref(false)
  /** 播放地址解析失败原因（如卡密缺失） */
  const error = ref('')
  /**
   * 音量 0..1。
   *
   * 初值只能是默认值：本 store 在 setup 阶段构建，而 settings 是异步 IPC 拉取的
   * （App.vue 的 `void settings.load()`），此刻 settings store 里还是 DEFAULT_SETTINGS。
   * 真实值由 hydrateFromSettings 在设置到位后灌入。
   */
  const volume = ref(DEFAULT_SETTINGS.player.volume)
  const muted = ref(false)

  const audio = new Audio()
  // kunyin:// 响应带 Access-Control-Allow-Origin；anonymous 让 captureStream 可旁路采样，
  // 也让音效模块能对它 createMediaElementSource（跨源且不带 CORS 时那一步会静音）。
  audio.crossOrigin = 'anonymous'
  // 只是把元素交给音效模块记下来，不建处理图 —— 建不建由设置决定（见 audio/soundEffect.ts）
  attachAudioElement(audio)
  audio.volume = volume.value
  const { devices, deviceError, refreshDevices } = useAudioDevices(audio, () => pause())

  const randomQueue = new PlaybackQueue()
  const failedKeys = new Set<string>()
  const trackListeners = new Set<(e: PlayerTrackEvent) => void>()
  function emitTrackEvent(e: PlayerTrackEvent): void {
    for (const cb of trackListeners) {
      try {
        cb(e)
      } catch {
        /* 旁路逻辑不得影响播放 */
      }
    }
  }
  /** 订阅播放事件，返回取消函数 */
  function onTrackEvent(cb: (e: PlayerTrackEvent) => void): () => void {
    trackListeners.add(cb)
    return () => trackListeners.delete(cb)
  }
  let skipTimer: ReturnType<typeof setTimeout> | null = null
  let forcedNext: string | null = null
  const sleepRemaining = ref(0)
  const sleepWaitForEnd = ref(false)
  let sleepInterval: ReturnType<typeof setInterval> | null = null
  const stopAfterTrack = ref(false)

  function cancelSleep(): void {
    if (sleepInterval) clearInterval(sleepInterval)
    sleepInterval = null
    sleepRemaining.value = 0
    stopAfterTrack.value = false
  }
  function setSleep(minutes: number, waitForEnd = false): void {
    cancelSleep()
    if (!Number.isFinite(minutes) || minutes <= 0) return
    sleepWaitForEnd.value = waitForEnd
    const deadline = Date.now() + Math.min(minutes, 1440) * 60000
    sleepRemaining.value = Math.ceil((deadline - Date.now()) / 1000)
    sleepInterval = setInterval(() => {
      sleepRemaining.value = Math.max(0, Math.ceil((deadline - Date.now()) / 1000))
      if (sleepRemaining.value) return
      cancelSleep()
      if (waitForEnd && !audio.paused) stopAfterTrack.value = true
      else pause()
    }, 500)
  }
  function isDisliked(item: MusicItem): boolean {
    const normalize = (v: string): string => v.trim().toLocaleLowerCase()
    return useSettingsStore()
      .settings.player.dislikeRules.split('\n')
      .some((rule) => {
        const value = normalize(rule)
        if (!value) return false
        return value.startsWith('@')
          ? item.artist.split(/[、,，/&]/).some((artist) => normalize(artist) === value.slice(1))
          : normalize(item.title) === value
      })
  }
  function eligibleQueue(): MusicItem[] {
    return queue.value.filter((item) => !isDisliked(item) && !failedKeys.has(getMusicItemKey(item)))
  }
  async function dislike(item: MusicItem, artist = false): Promise<void> {
    const store = useSettingsStore()
    const rules = store.settings.player.dislikeRules.split('\n').filter(Boolean)
    const added = artist
      ? item.artist
          .split(/[、,，/&]/)
          .map((name) => '@' + name.trim())
          .filter((name) => name.length > 1)
      : [item.title.trim()]
    try {
      await store.update({
        player: { dislikeRules: [...new Set([...rules, ...added])].join('\n') }
      })
      if (current.value && isDisliked(current.value)) next()
    } catch {
      error.value = '无法保存不喜欢设置，请重试'
    }
  }
  function reportFailure(reason: string): void {
    audio.pause()
    loading.value = false
    playing.value = false
    error.value = reason
    if (!current.value || !useSettingsStore().settings.player.autoSkipOnError) return
    failedKeys.add(getMusicItemKey(current.value))
    if (!eligibleQueue().length) {
      error.value = '队列中的歌曲均无法播放，请检查网络或更换音源'
      return
    }
    if (skipTimer) clearTimeout(skipTimer)
    skipTimer = setTimeout(() => {
      skipTimer = null
      step(1)
    }, 2000)
  }
  /**
   * 生效中的倍速（<audio>.playbackRate 的真值）。
   *
   * 与设置里的 `player.playbackRate` 不是一回事：滑杆拖动中的试听只改元素、不落盘，
   * 这个 ref 跟着元素走。歌词引擎必须以它为准——引擎自走一条墙钟时钟，
   * 不同步倍速的话歌词会越放越落后（见 `composables/useLyricPlayer.ts` 的 setPlaybackRate）。
   */
  const playbackRate = ref(1)

  function applyPlaybackRate(rate: number): void {
    const next = Number.isFinite(rate) ? Math.max(0.5, Math.min(2, rate)) : 1
    audio.playbackRate = next
    playbackRate.value = next
  }

  watch(
    () =>
      [
        useSettingsStore().settings.player.playbackRate,
        useSettingsStore().settings.player.preservesPitch
      ] as const,
    ([rate, keepPitch]) => {
      applyPlaybackRate(rate as number)
      // 关掉就是「变速变调」的花栗鼠效果；与音效里的升降调是两回事（那一路不改速度）
      audio.preservesPitch = !!keepPitch
    },
    { immediate: true }
  )

  /**
   * 只改 <audio> 不落盘：播放页速度滑杆拖动中的实时试听。
   * 松手时调用方再写设置，上面的 watcher 会把同一个值正式落到元素上。
   * （设置每写一次就是一次 JSON 原子写，按住滑杆拖会写成百上千次。）
   */
  function previewPlaybackRate(rate: number): void {
    if (!Number.isFinite(rate)) return
    applyPlaybackRate(rate)
  }

  // 频谱有两条来源，取决于音效处理图建没建（见 audio/soundEffect.ts）：
  // - 没建图（默认）：captureStream 旁路采样。这条路**不碰**原输出链路，代价是 sink 泄漏
  //   风险大（见下方 stopCapturedStream）、拿到音轨的时机还得靠轮询等。
  // - 建了图：直接用图里的 analyser，既准确又没有旁路开销。此时不能再走 captureStream——
  //   声音已经不从元素直出，capture 到的是静音，白挂一堆摘不掉的 sink。
  let audioContext: AudioContext | null = null
  let capturedStream: MediaStream | null = null
  let spectrumGraph: { source: MediaStreamAudioSourceNode; sink: GainNode } | null = null
  let analyser: AnalyserNode | null = null
  let spectrumBytes: Uint8Array<ArrayBuffer> | null = null
  /** 音效图 analyser 的取样缓冲（与旁路那条各用各的，fftSize 可能不同） */
  let effectBytes: Uint8Array<ArrayBuffer> | null = null
  let spectrumAttachTimer: ReturnType<typeof setTimeout> | null = null

  /**
   * 停掉旁路采样流的全部轨道。
   *
   * ⚠ 只把引用置空是不够的：captureStream() 每调一次就给 <audio> 挂一条**不会自动摘除**
   * 的 audio sink，而 live 的 MediaStreamTrack 有 pending activity（还能派发 ended），
   * GC 也不会回收它。于是切歌一次泄漏一条 sink：音频渲染线程上挂着越来越多的旁路
   * 在拉 PCM，更要紧的是残留 sink 会拖住上一首的媒体管线无法释放，新 src 的加载被排在
   * 这些资源后面——症状就是「听久了切歌加载越来越慢」。必须显式 stop。
   */
  function stopCapturedStream(): void {
    for (const track of capturedStream?.getTracks() ?? []) {
      try {
        track.stop()
      } catch {
        /* 已结束的轨道再 stop 不算错 */
      }
    }
    capturedStream = null
  }

  function resetSpectrumStream(): void {
    if (spectrumAttachTimer) clearTimeout(spectrumAttachTimer)
    spectrumAttachTimer = null
    spectrumGraph?.source.disconnect()
    analyser?.disconnect()
    spectrumGraph?.sink.disconnect()
    stopCapturedStream()
    spectrumGraph = null
    analyser = null
    spectrumBytes = null
  }

  function attachSpectrumStream(): void {
    // 音效处理图在跑：频谱直接取图里的 analyser，旁路这条路必须让开
    if (isSoundEffectActive()) return
    const context = audioContext
    if (!context || context.state !== 'running' || analyser || spectrumGraph) return
    const capture = (
      audio as HTMLAudioElement & {
        captureStream?: () => MediaStream
      }
    ).captureStream
    if (!capture) return
    try {
      // 每首歌只 capture 一次。音轨要等解码器就绪才出现，但 Chromium 是往**同一个流**里
      // addTrack（旧实现能观察到「同时残留旧/新轨道」正是这个行为），所以拿到暂时没有
      // 音轨的空流时应当留着它等轨道长出来，而不是丢掉重 capture——每次重 capture 都白挂
      // 一条摘不掉的 sink（见 stopCapturedStream），重试 20 次就泄漏 20 条。
      // 流由 setAudioSource / emptied 经 resetSpectrumStream 统一 stop。
      const tracks = capturedStream?.getAudioTracks() ?? []
      // 长出过轨道却全部 ended：这条流再也不会有 live 轨道，停掉后重建。
      // 仅凭「还没有轨道」不能判失效——那正是等待解码器就绪的正常中间态。
      if (tracks.length && !tracks.some((track) => track.readyState === 'live')) {
        stopCapturedStream()
      }
      if (!capturedStream) capturedStream = capture.call(audio)
      const activeTrack = capturedStream
        .getAudioTracks()
        .filter((track) => track.readyState === 'live')
        .at(-1)
      if (!activeTrack) return

      const nextAnalyser = context.createAnalyser()
      nextAnalyser.fftSize = 256
      nextAnalyser.smoothingTimeConstant = 0.76
      nextAnalyser.minDecibels = -90
      nextAnalyser.maxDecibels = -18
      // captureStream 在切换 src 后可能同时残留旧/新轨道；只分析最后一个 live track。
      const nextSource = context.createMediaStreamSource(new MediaStream([activeTrack]))
      // 零增益输出只用于让分析图持续处理；原声音仍由 <audio> 自己直出，不会重复播放。
      const nextSink = context.createGain()
      nextSink.gain.value = 0
      nextSource.connect(nextAnalyser)
      nextAnalyser.connect(nextSink)
      nextSink.connect(context.destination)

      spectrumGraph = { source: nextSource, sink: nextSink }
      analyser = nextAnalyser
      spectrumBytes = new Uint8Array(nextAnalyser.frequencyBinCount)
    } catch (e) {
      console.warn('[player] 无法接入实时音频频谱旁路', e)
    }
  }

  // 音效：deep 监听整段设置。全是默认值时 applySoundEffect 直接返回，不会建处理图。
  // 必须放在上面那几个频谱 let 声明之后 —— immediate 回调是同步执行的，
  // 搁在声明前面一旦走进 resetSpectrumStream 就会撞上 TDZ。
  watch(
    () => useSettingsStore().settings.player.soundEffect,
    (effect) => {
      const active = applySoundEffect(effect)
      // 图刚建起来的那一刻，旁路采样这条路就作废了（capture 到的是静音），收掉它
      if (active) resetSpectrumStream()
    },
    { deep: true, immediate: true }
  )

  function scheduleSpectrumAttach(attempt = 0): void {
    if (spectrumAttachTimer) clearTimeout(spectrumAttachTimer)
    spectrumAttachTimer = null
    attachSpectrumStream()
    if (analyser || audio.paused || attempt >= 20) return
    // 不同音频格式创建 captureStream track 的时机略有差异，最多等待 2 秒。
    spectrumAttachTimer = setTimeout(() => scheduleSpectrumAttach(attempt + 1), 100)
  }

  function enableAudioSpectrum(): void {
    const activation = (navigator as Navigator & { userActivation?: { isActive: boolean } })
      .userActivation
    if (!audioContext && activation && !activation.isActive) return
    if (audioContext) {
      if (audioContext.state === 'suspended') {
        void audioContext
          .resume()
          .then(attachSpectrumStream)
          .catch(() => {})
      } else {
        attachSpectrumStream()
      }
      return
    }

    const context = new AudioContext()
    audioContext = context
    void context
      .resume()
      .then(attachSpectrumStream)
      .catch((e: unknown) => {
        if (audioContext === context) audioContext = null
        void context.close().catch(() => {})
        console.warn('[player] 无法初始化实时音频频谱', e)
      })
  }

  /**
   * 换播放源。先停掉旁路采样再设 src：不依赖 `emptied` 的派发时序，
   * 保证上一首挂在 <audio> 上的 audio sink 一定被摘掉（见 stopCapturedStream）。
   */
  function setAudioSource(url: string): void {
    resetSpectrumStream()
    audio.src = url
  }

  /** 当前该用哪个分析器：音效图优先，否则用 captureStream 旁路那一个 */
  function activeAnalyser(): { node: AnalyserNode; bytes: Uint8Array<ArrayBuffer> } | null {
    const effect = getEffectAnalyser()
    if (effect) {
      if (!effectBytes || effectBytes.length !== effect.frequencyBinCount) {
        effectBytes = new Uint8Array(effect.frequencyBinCount)
      }
      return { node: effect, bytes: effectBytes }
    }
    if (!analyser || !spectrumBytes || audioContext?.state !== 'running') return null
    return { node: analyser, bytes: spectrumBytes }
  }

  function getSpectrumData(): number[] {
    const bars = new Array<number>(SPECTRUM_BAR_COUNT).fill(0)
    const active = audio.paused ? null : activeAnalyser()
    if (!active) return bars
    const spectrumBytes = active.bytes
    active.node.getByteFrequencyData(spectrumBytes)
    // 频率桶按幂次划分：低频保留更多分辨率，高频合并，视觉上更接近真实音乐频谱。
    const usableBins = Math.min(spectrumBytes.length, 96)
    for (let i = 0; i < SPECTRUM_BAR_COUNT; i++) {
      const start = Math.max(1, Math.floor((i / SPECTRUM_BAR_COUNT) ** 1.55 * (usableBins - 1)))
      const end = Math.max(
        start + 1,
        Math.floor(((i + 1) / SPECTRUM_BAR_COUNT) ** 1.55 * (usableBins - 1))
      )
      let sum = 0
      let peak = 0
      for (let bin = start; bin <= Math.min(end, usableBins - 1); bin++) {
        const value = spectrumBytes[bin]
        sum += value
        if (value > peak) peak = value
      }
      const count = Math.max(1, Math.min(end, usableBins - 1) - start + 1)
      const level = (sum / count / 255) * 0.72 + (peak / 255) * 0.28
      bars[i] = Math.round(Math.max(0, Math.min(1, level)) * 1000) / 1000
    }
    return bars
  }

  window.addEventListener(
    'pointerdown',
    () => {
      if (useSettingsStore().settings.lyrics.desktopAudioVisualization) enableAudioSpectrum()
    },
    { capture: true }
  )

  audio.addEventListener('timeupdate', () => {
    currentTime.value = Math.floor(audio.currentTime * 1000)
    if (audio.paused) return
    // 进度实时落盘：独立小 key（每次约几十字节，timeupdate ~4 次/s 可忽略），
    // 完整状态含整个队列，高频序列化太贵，仍每 5s 兜底一次
    persistPosition()
    if (duration.value > 10000 && duration.value - currentTime.value < 10000) void prepareNext()
    if (Date.now() - lastPersistAt > 5000) persistState()
  })
  audio.addEventListener('durationchange', () => {
    duration.value = Number.isFinite(audio.duration) ? Math.floor(audio.duration * 1000) : 0
  })
  audio.addEventListener('emptied', resetSpectrumStream)
  audio.addEventListener('loadeddata', () => {
    if (useSettingsStore().settings.lyrics.desktopAudioVisualization) scheduleSpectrumAttach()
  })
  audio.addEventListener('play', () => {
    playing.value = true
    if (useSettingsStore().settings.lyrics.desktopAudioVisualization) {
      enableAudioSpectrum()
      attachSpectrumStream()
    }
  })
  // play 事件可能早于 captureStream 音轨创建；playing 表示解码输出已真正开始，
  // 此时重新 capture 才能稳定拿到 live audio track。
  audio.addEventListener('playing', () => {
    failedKeys.clear()
    if (useSettingsStore().settings.lyrics.desktopAudioVisualization) {
      enableAudioSpectrum()
      scheduleSpectrumAttach()
    }
  })
  audio.addEventListener('pause', () => {
    if (spectrumAttachTimer) clearTimeout(spectrumAttachTimer)
    spectrumAttachTimer = null
    playing.value = false
    persistState()
  })
  audio.addEventListener('ended', () => {
    if (current.value) emitTrackEvent({ type: 'ended', item: current.value })
    if (stopAfterTrack.value) {
      stopAfterTrack.value = false
      pause()
      return
    }
    if (forcedNext) next()
    else if (playMode.value === 'singleLoop' && current.value && !isDisliked(current.value)) {
      seek(0)
      void audio.play().catch(() => {})
    } else if (playMode.value === 'order' && !peekNext()) pause()
    else next()
  })
  audio.addEventListener('error', () => {
    if (loading.value) return
    const item = current.value
    const q = quality.value
    if (!item) return
    // 直链过期/403：使 URL 缓存失效并重试一次当前曲目。
    // 用 loadForResume 从出错位置续播（保持原音质优先）——直链过期多发生在播放中途，
    // 走 loadAndPlay 会把 currentTime 清零从头重播，随后的持久化再把 0 写回存档，进度就丢了。
    if (q && !retriedAfterError) {
      retriedAfterError = true
      void window.api.player.invalidateUrl(
        JSON.parse(JSON.stringify(actualStreamItem ?? item)) as MusicItem,
        q
      )
      void loadForResume(item, currentTime.value, playing.value || !audio.paused, q)
      return
    }
    // 重试后仍失败：如实报出来，别只留一条 console 错误
    // MEDIA_ERR_NETWORK/SRC_NOT_SUPPORTED 最常见的成因是代理不可用或直链被拒
    playing.value = false
    loading.value = false
    reportFailure(describeMediaError(audio.error))
  })

  // ============ 播放状态持久化（记住歌曲/队列/进度/静音） ============
  const SAVE_KEY = 'kunyin:playback'
  /** 实时进度存档（只含歌曲身份+进度的小对象，可承受 timeupdate 频率的写入） */
  const POS_KEY = 'kunyin:playback:pos'
  /** 当前实际播放的音质（播放页音质菜单高亮；错误重试时失效缓存用） */
  const quality = ref('')
  let retriedAfterError = false
  /** 加载序号：并发的 loadAndPlay / loadForResume 只认最后一次（见 loadAndPlay 注释） */
  let loadToken = 0
  let lastPersistAt = 0
  let persistTimer: ReturnType<typeof setTimeout> | null = null

  interface SavedPlayback {
    item: MusicItem
    queue: MusicItem[]
    index: number
    queueSource: QueueSource | null
    positionMs: number
    muted: boolean
    /** 上次实际播放的音质：恢复时优先尝试（可能与全局首选不同，如首选档缺失时的回退档） */
    quality?: string
  }

  function persistState(): void {
    lastPersistAt = Date.now()
    if (!current.value) return
    persistPosition() // 同步小存档，保证它永远不比完整存档旧（如暂停态拖进度条）
    const state: SavedPlayback = {
      item: current.value,
      queue: queue.value,
      index: index.value,
      queueSource: queueSource.value,
      positionMs: currentTime.value,
      muted: muted.value,
      quality: quality.value
    }
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(state))
    } catch {
      /* 队列过大写不下则放弃 */
    }
  }
  /** 只写歌曲身份 + 进度的小存档（timeupdate 每次都调，恢复时校验身份再采用） */
  function persistPosition(): void {
    const c = current.value
    if (!c) return
    try {
      localStorage.setItem(
        POS_KEY,
        JSON.stringify({ id: c.id, type: c.type, positionMs: currentTime.value })
      )
    } catch {
      /* ignore */
    }
  }
  /** 切歌/队列变化后防抖保存（进度由 timeupdate 单独按 5s 节流） */
  function schedulePersist(): void {
    if (persistTimer) clearTimeout(persistTimer)
    persistTimer = setTimeout(persistState, 800)
  }
  window.addEventListener('beforeunload', persistState)

  /**
   * 音质尝试顺序：从首选档开始逐级**降级**，首选档及更低档全不可用时才向上取最接近的。
   * 与下载侧（download/manager.ts 的 pickQuality / resolveWithFallback）共用 @common 的
   * 同一套档位顺序，播放与下载的降级行为因此始终一致。
   *
   * 早先这里自带一份档位表并从最低档往上爬，首选档取流失败就直接掉到 128K——
   * 明明有 HiRes 权限也只能听标准音质。改为真正的降级后，拿到的是最接近首选的可用档。
   * 开启「屏蔽 AI 音质」后，被屏蔽的档位（全景声等）整条链路都不参与取流。
   */
  function qualityOrder(item: MusicItem): string[] {
    const settings = useSettingsStore().settings
    const preferred = settings.player.preferredQuality
    const blocked = blockedQualityIds(settings)
    const order = qualityFallbackOrder(preferred, item.qualities, blocked)
    order.push(...qualityUpgradeOrder(preferred, item.qualities, blocked))
    // 各源自定义的非标准档位键兜底（与下载侧 pickQuality 的收尾同理）
    for (const q of Object.keys(item.qualities))
      if (!blocked.includes(q) && !order.includes(q)) order.push(q)
    return order.length ? order : ['128k']
  }

  /**
   * 「当前曲已变」判断：按歌曲身份（id+type）比，绝不能比对象引用——
   * current.value 里存的是 Vue reactive 代理，与调用方手里的原始对象（如 restore 的
   * JSON.parse 结果）引用不等，引用比较会把正常加载误判成过期而中途放弃。
   */
  function isCurrent(item: MusicItem): boolean {
    const c = current.value
    return !!c && c.id === item.id && c.type === item.type
  }

  let preload: { key: string; result: AudioStreamResult } | null = null
  let preloadKey = ''
  let actualStreamItem: MusicItem | null = null
  let cancelMetadata: (() => void) | null = null
  const warmAudio = new Audio()
  warmAudio.muted = true
  warmAudio.preload = 'auto'
  function clearPreload(): void {
    preload = null
    preloadKey = ''
    warmAudio.removeAttribute('src')
    warmAudio.load()
  }
  async function withTimeout<T>(promise: Promise<T>, ms = 20000): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('加载超时')), ms)
        })
      ])
    } finally {
      clearTimeout(timer)
    }
  }
  function peekNext(): MusicItem | undefined {
    const items = eligibleQueue()
    const key = current.value ? getMusicItemKey(current.value) : ''
    if (forcedNext) return items.find((item) => getMusicItemKey(item) === forcedNext)
    if (playMode.value === 'singleLoop') return current.value ?? undefined
    if (playMode.value === 'random') {
      const nextKey = randomQueue.peek(items.map(getMusicItemKey), key)
      return items.find((item) => getMusicItemKey(item) === nextKey)
    }
    for (let offset = 1; offset <= queue.value.length; offset++) {
      if (playMode.value === 'order' && index.value + offset >= queue.value.length) return undefined
      const item = queue.value[(index.value + offset) % queue.value.length]
      if (items.includes(item)) return item
    }
    return undefined
  }
  async function prepareNext(): Promise<void> {
    if (!useSettingsStore().settings.player.preloadNext || loading.value) return
    const item = peekNext()
    if (!item || isCurrent(item)) return
    const q = qualityOrder(item)[0]
    const key = getMusicItemKey(item) + ':' + q
    if (preloadKey === key) return
    clearPreload()
    preloadKey = key
    try {
      const result = await withTimeout(
        window.api.player.stream(JSON.parse(JSON.stringify(item)), q)
      )
      if (preloadKey !== key || !result.ok) return
      preload = { key, result }
      warmAudio.src = result.url
      warmAudio.load()
    } catch {
      /* 正式播放时重试 */
    }
  }
  watch(
    () => [
      useSettingsStore().settings.player.preferredQuality,
      useSettingsStore().settings.player.preloadNext,
      useSettingsStore().settings.player.dislikeRules,
      playMode.value,
      queue.value.map(getMusicItemKey).join('|')
    ],
    clearPreload
  )

  async function loadTrack(
    item: MusicItem,
    positionMs: number,
    autoplay: boolean,
    preferQuality = ''
  ): Promise<void> {
    log.info('开始加载歌曲', { source: item.type, id: item.id, preferQuality, autoplay })
    const token = ++loadToken
    const deadline = Date.now() + 60000
    const stale = (): boolean => token !== loadToken || !isCurrent(item)
    cancelMetadata?.()
    if (skipTimer) clearTimeout(skipTimer)
    skipTimer = null
    audio.pause()
    loading.value = true
    error.value = ''
    currentTime.value = positionMs
    duration.value = item.duration
    const tryItem = async (target: MusicItem): Promise<boolean> => {
      const order = qualityOrder(target)
      if (preferQuality && order.includes(preferQuality))
        order.unshift(...order.splice(order.indexOf(preferQuality), 1))
      for (const q of order) {
        if (stale()) return false
        if (Date.now() >= deadline) {
          error.value = '加载超时'
          return false
        }
        try {
          const key = getMusicItemKey(target) + ':' + q
          const cached =
            preload?.key === key &&
            (!preload.result.expire || preload.result.expire > Date.now() + 5000)
              ? preload.result
              : null
          const res =
            cached ??
            (await withTimeout(window.api.player.stream(JSON.parse(JSON.stringify(target)), q)))
          if (stale()) return false
          if (!res.ok) {
            log.warn('音质取流失败', {
              source: target.type,
              id: target.id,
              quality: q,
              reason: res.reason
            })
            error.value = res.reason ?? '解析失败'
            continue
          }
          quality.value = res.quality || q
          actualStreamItem = target
          let cleanup = (): void => {}
          const ready = new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => {
              cleanup()
              reject(new Error('音频加载超时'))
            }, 25000)
            const done = (): void => {
              cleanup()
              resolve()
            }
            const fail = (): void => {
              cleanup()
              reject(new Error(describeMediaError(audio.error)))
            }
            cancelMetadata = done
            cleanup = (): void => {
              clearTimeout(timer)
              audio.removeEventListener('loadedmetadata', done)
              audio.removeEventListener('error', fail)
              if (cancelMetadata === done) cancelMetadata = null
            }
            audio.addEventListener('loadedmetadata', done)
            audio.addEventListener('error', fail)
          })
          setAudioSource(res.url)
          audio.volume = muted.value ? 0 : volume.value
          try {
            await ready
          } finally {
            cleanup()
          }
          if (stale()) return false
          clearPreload()
          if (positionMs > 0)
            audio.currentTime = Math.min(
              positionMs / 1000,
              Number.isFinite(audio.duration) ? audio.duration : positionMs / 1000
            )
          if (autoplay) await withTimeout(audio.play(), 25000)
          if (stale()) return false
          error.value = ''
          emitTrackEvent({ type: 'loaded', item: target })
          return true
        } catch (e) {
          if (stale()) return false
          log.warn('音频加载或播放失败', {
            error: e,
            source: target.type,
            id: target.id,
            quality: q,
            mediaError: audio.error?.code
          })
          audio.pause()
          error.value = e instanceof Error ? e.message : '播放失败'
        }
      }
      return false
    }
    try {
      if ((await tryItem(item)) || stale()) return
      if (item.type !== 'local' && useSettingsStore().settings.player.autoSwitchSource) {
        const normalize = (value: string): string => value.trim().toLowerCase().replaceAll(' ', '')
        for (const source of ['wy', 'kg', 'kw', 'qq'] as MusicSource[]) {
          if (Date.now() >= deadline) break
          if (source === item.type || stale()) continue
          error.value = '正在尝试其他音源…'
          const result = await withTimeout(
            window.api.search.songs(source, item.title + ' ' + item.artist, 0, 5)
          ).catch(() => null)
          if (stale()) return
          const match = result?.result.find(
            (candidate) =>
              normalize(candidate.title) === normalize(item.title) &&
              normalize(candidate.artist) === normalize(item.artist) &&
              (!candidate.duration ||
                !item.duration ||
                Math.abs(candidate.duration - item.duration) < 5000)
          )
          if (match && (await tryItem(match))) return
        }
      }
      if (!stale()) {
        log.warn('歌曲加载尝试耗尽', { source: item.type, id: item.id, reason: error.value })
        if (autoplay)
          reportFailure(
            error.value === '正在尝试其他音源…' ? '当前歌曲暂无可用音源' : error.value || '无法播放'
          )
        else error.value = error.value || '无法恢复上次播放'
      }
    } finally {
      if (token === loadToken) loading.value = false
    }
  }
  async function loadAndPlay(item: MusicItem): Promise<void> {
    await loadTrack(item, 0, true)
  }
  async function loadForResume(
    item: MusicItem,
    positionMs: number,
    autoplay: boolean,
    preferQuality = ''
  ): Promise<void> {
    await loadTrack(item, positionMs, autoplay, preferQuality)
  }

  /** 音量和静音独立于播放存档，在设置加载完成后统一恢复。 */
  async function hydrateFromSettings(): Promise<void> {
    const settings = useSettingsStore()
    await settings.load()
    const p = settings.settings.player
    volume.value = Math.max(0, Math.min(1, Number.isFinite(p.volume) ? p.volume : 1))
    muted.value = !!p.muted
    audio.volume = muted.value ? 0 : volume.value
    if (PLAY_MODES.includes(p.playMode)) playMode.value = p.playMode
  }

  let restored = false
  /** 启动恢复：读出上次播放的歌曲/队列/进度（App.vue onMounted 调用一次） */
  async function restore(): Promise<void> {
    if (restored) return
    restored = true
    try {
      await hydrateFromSettings()
    } catch (e) {
      restored = false
      throw e
    }
    if (current.value) return
    let saved: SavedPlayback | null = null
    try {
      const raw = localStorage.getItem(SAVE_KEY)
      saved = raw ? (JSON.parse(raw) as SavedPlayback) : null
    } catch {
      saved = null
    }
    if (!saved?.item) return
    // 实时进度小存档比完整存档新（完整存档 5s 一写），身份匹配当前曲时优先采用
    let positionMs = Math.max(0, saved.positionMs ?? 0)
    try {
      const rawPos = localStorage.getItem(POS_KEY)
      const pos = rawPos
        ? (JSON.parse(rawPos) as { id: number; type: string; positionMs: number })
        : null
      if (pos && pos.id === saved.item.id && pos.type === saved.item.type && pos.positionMs > 0) {
        positionMs = pos.positionMs
      }
    } catch {
      /* 小存档损坏则用完整存档的进度 */
    }
    queue.value = Array.isArray(saved.queue) ? saved.queue : []
    index.value = typeof saved.index === 'number' ? saved.index : -1
    queueSource.value = saved.queueSource ?? null
    randomQueue.record(getMusicItemKey(saved.item))
    audio.volume = muted.value ? 0 : volume.value
    current.value = saved.item
    duration.value = saved.item.duration
    // 音质/进度先按记忆值上屏（菜单高亮 + 进度条归位）；解析直链失败也不至于显示回 0:00，
    // 更避免后续持久化把 0 写回存档覆盖掉真实进度。加载成功后由 loadForResume 内 seek 对齐。
    if (saved.quality) quality.value = saved.quality
    currentTime.value = positionMs
    const autoplay = useSettingsStore().settings.player.autoPlay
    await loadForResume(saved.item, positionMs, autoplay, saved.quality ?? '')
  }

  /**
   * 播放一首歌。
   * @param list 设为播放队列（浏览页传歌单/专辑等结果列表）
   * @param opts.source 队列来源列表（用于「正在播放的列表」标记；不传则视为无来源）
   * @param opts.trackTrial 是否把该曲累积进「试听列表」（专辑/歌手点单曲时作历史累积）。
   *   从试听列表自身播放时应传 false，避免自我扰动。默认 false（不动试听列表）。
   *   搜索点单曲请用 playInTrial——试听列表即其播放上下文，不只是历史记录。
   */
  function playItem(
    item: MusicItem,
    list?: MusicItem[],
    opts?: { trackTrial?: boolean; source?: QueueSource }
  ): void {
    if (useSettingsStore().settings.lyrics.desktopAudioVisualization) enableAudioSpectrum()
    if (isDisliked(item)) {
      error.value = '该歌曲已在不喜欢列表中，可在播放设置中移除'
      return
    }
    if (skipTimer) clearTimeout(skipTimer)
    skipTimer = null
    if (
      list &&
      (list.length !== queue.value.length ||
        list.some((song, i) => getMusicItemKey(song) !== getMusicItemKey(queue.value[i])))
    )
      randomQueue.reset()
    randomQueue.record(getMusicItemKey(item))
    failedKeys.delete(getMusicItemKey(item))
    current.value = item
    retriedAfterError = false // 用户主动切歌：允许错误重试
    if (list) {
      queue.value = list
      // 用歌曲身份而非引用定位：队列可能是主进程重新序列化的对象（如试听列表），引用比较会失配
      index.value = Math.max(
        0,
        list.findIndex((m) => getMusicItemKey(m) === getMusicItemKey(item))
      )
      queueSource.value = opts?.source ?? null
    }
    schedulePersist()
    if (opts?.trackTrial) {
      // 追加到试听列表末尾（atHead=false，去重）—— 累积不覆盖、不打乱既有顺序
      const plain = JSON.parse(JSON.stringify(item)) as MusicItem
      void window.api.library.addToTrial(plain, false).catch(() => {})
    }
    void loadAndPlay(item)
  }

  /**
   * 试听播放（搜索点单曲）：把该曲累积进试听列表，再以**整个试听列表**为队列播放——
   * 试听列表即试听场景的播放上下文（对齐 LX）：上一首/下一首在试听历史内导航，
   * 播完自动接下一首，而不是单曲循环或跳进其他搜索结果。
   * 拉取失败时退化为只放该曲，保证可播。
   */
  async function playInTrial(item: MusicItem): Promise<void> {
    if (isDisliked(item)) {
      error.value = '该歌曲已在不喜欢列表中'
      return
    }
    const request = ++loadToken
    if (useSettingsStore().settings.lyrics.desktopAudioVisualization) enableAudioSpectrum()
    // 过 IPC 需普通对象（Pinia 响应式 Proxy 无法被 structuredClone）
    const plain = JSON.parse(JSON.stringify(item)) as MusicItem
    // 先累积再拉列表：await 串行保证队列里一定包含本曲。
    // 主进程 INSERT OR IGNORE 去重——已存在的歌保持原位，不会被挪到末尾。
    await window.api.library.addToTrial(plain, false).catch(() => {})
    const list = await window.api.library.trialSongs().catch(() => [] as MusicItem[])
    if (request !== loadToken) return
    const q = list.length ? list : [plain]
    if (isDisliked(item)) {
      error.value = '该歌曲已在不喜欢列表中'
      return
    }
    randomQueue.reset()
    randomQueue.record(getMusicItemKey(item))
    failedKeys.clear()
    current.value = item
    retriedAfterError = false // 用户主动切歌：允许错误重试
    queue.value = q
    queueSource.value = { kind: 'trial', name: '试听列表' }
    // trialSongs 是主进程新序列化出的对象，引用比较找不到，按歌曲身份定位
    const key = getMusicItemKey(item)
    index.value = Math.max(
      0,
      q.findIndex((m) => getMusicItemKey(m) === key)
    )
    schedulePersist()
    void loadAndPlay(item)
  }

  function toggle(): void {
    if (!current.value) return
    if (useSettingsStore().settings.lyrics.desktopAudioVisualization) enableAudioSpectrum()
    if (audio.paused && !loading.value) play()
    else pause()
  }

  /**
   * 明确「播放」/「暂停」（幂等）。
   *
   * SMTC / 耳机线控给的是明确语义的 play / pause 命令，不能翻译成 toggle：
   * playing 要等 <audio> 的 play 事件才置 true，命令连续到达（蓝牙 AVRCP 常同时
   * 合成按键与 SMTC 事件）时两次都会读到旧值，第二次就把刚开始的播放又暂停掉。
   * 直接按 audio.paused 判断则天然幂等，重复命令是空操作。
   */
  function play(): void {
    if (!current.value || !audio.paused || loading.value) return
    if (useSettingsStore().settings.lyrics.desktopAudioVisualization) enableAudioSpectrum()
    failedKeys.clear()
    if (error.value || !audio.src) void loadForResume(current.value, currentTime.value, true)
    else void audio.play().catch(() => {})
  }
  function pause(): void {
    ++loadToken
    cancelMetadata?.()
    if (loading.value) error.value = '加载已暂停'
    loading.value = false
    if (skipTimer) clearTimeout(skipTimer)
    skipTimer = null
    if (!audio.paused) audio.pause()
  }

  /**
   * 「下一首播放」：把歌曲插入队列，紧跟当前曲之后，不打断当前播放。
   * 队列为空或未在播放时，直接开始播放该曲。已在队列中的先去重再插入。
   */
  function playNext(item: MusicItem): void {
    if (!current.value || !queue.value.length) {
      playItem(item, [item], { source: { kind: 'single' } })
      return
    }
    const key = (m: MusicItem): string => `${m.id}_${m.type}`
    const q = queue.value.slice()
    const dup = q.findIndex((m) => key(m) === key(item))
    if (dup >= 0 && dup <= index.value) {
      // 去重项在当前之前，移除会使 index 前移一位
      q.splice(dup, 1)
      index.value -= 1
    } else if (dup > index.value) {
      q.splice(dup, 1)
    }
    q.splice(index.value + 1, 0, item)
    queue.value = q
    forcedNext = getMusicItemKey(item)
    clearPreload()
    schedulePersist()
  }

  /**
   * 从播放队列移除一首歌（列表删除歌曲时同步调用）。
   * 删除的是当前播放曲时，立即接播队列「下一首」（队列已空则停止），不再播已删的歌；
   * 删除其他位置的曲只做数组剔除，index 保持指向不变，prev/next 也切不到已删的这首。
   */
  /**
   * 向当前队列末尾追加歌曲（按 key 去重）。传入 source 时仅在队列来源仍是它的情况下生效，
   * 供排行榜「播放全部」先播首页、后台拉完余页再补进队列（对齐 LX playSongListDetail）。
   * 返回 false 表示队列已被切走、追加被忽略。
   */
  function appendToQueue(items: MusicItem[], source?: QueueSource): boolean {
    if (
      source &&
      (queueSource.value?.kind !== source.kind ||
        (queueSource.value?.id ?? '') !== (source.id ?? ''))
    )
      return false
    const keys = new Set(queue.value.map(getMusicItemKey))
    const added = items.filter((m) => !keys.has(getMusicItemKey(m)))
    if (!added.length) return true
    queue.value = [...queue.value, ...added]
    schedulePersist()
    return true
  }

  function removeFromQueue(item: MusicItem): void {
    const key = getMusicItemKey(item)
    const idx = queue.value.findIndex((m) => getMusicItemKey(m) === key)
    if (idx < 0) return
    const removingCurrent =
      idx === index.value && !!current.value && getMusicItemKey(current.value) === key
    queue.value.splice(idx, 1)
    clearPreload()
    if (removingCurrent) {
      pause()
      const target = queue.value
        .slice(idx)
        .concat(queue.value.slice(0, idx))
        .find((song) => !isDisliked(song))
      if (target) playItem(target, queue.value, { source: queueSource.value ?? undefined })
      else {
        current.value = null
        index.value = -1
        audio.removeAttribute('src')
        audio.load()
        localStorage.removeItem(SAVE_KEY)
        localStorage.removeItem(POS_KEY)
      }
      schedulePersist()
      return
    }
    if (idx <= index.value) index.value -= 1
    if (index.value < 0) index.value = queue.value.length ? 0 : -1
    schedulePersist()
  }

  function seek(ms: number): void {
    if (!current.value || !Number.isFinite(ms)) return
    const position = Math.max(0, duration.value > 0 ? Math.min(ms, duration.value) : ms)
    audio.currentTime = position / 1000
    currentTime.value = position
    emitTrackEvent({ type: 'seek', item: current.value, positionMs: position })
    // 暂停态拖进度条后 timeupdate 不跑、pause 也不会再触发，异常退出就会丢掉新位置
    schedulePersist()
  }

  function step(delta: number): void {
    const items = eligibleQueue()
    if (!items.length) {
      pause()
      return
    }
    let target: MusicItem | undefined
    if (forcedNext && delta > 0) target = items.find((item) => getMusicItemKey(item) === forcedNext)
    if (!target && playMode.value === 'random') {
      const key = randomQueue.move(
        items.map(getMusicItemKey),
        current.value ? getMusicItemKey(current.value) : '',
        delta
      )
      target = items.find((item) => getMusicItemKey(item) === key)
    } else if (!target) {
      for (let offset = 1; offset <= queue.value.length; offset++) {
        const i = (index.value + delta * offset + queue.value.length) % queue.value.length
        if (items.includes(queue.value[i])) {
          target = queue.value[i]
          break
        }
      }
    }
    if (!target) return
    forcedNext = null
    playItem(target, queue.value, { source: queueSource.value ?? undefined })
  }
  function next(): void {
    step(1)
  }
  function prev(): void {
    step(-1)
  }

  /** 设音量（0..1），实时应用到 audio 并持久化到设置 */
  function setVolume(v: number): void {
    const clamped = Math.max(0, Math.min(1, Number.isFinite(v) ? v : volume.value))
    volume.value = clamped
    if (clamped > 0) muted.value = false
    audio.volume = muted.value ? 0 : clamped
    void useSettingsStore().update({ player: { volume: clamped, muted: muted.value } })
  }
  function toggleMute(): void {
    muted.value = !muted.value
    void useSettingsStore().update({ player: { muted: muted.value } })
    audio.volume = muted.value ? 0 : volume.value
  }

  const PLAY_MODES: PlayMode[] = ['listLoop', 'singleLoop', 'random', 'order']
  function cyclePlayMode(): void {
    const i = PLAY_MODES.indexOf(playMode.value)
    playMode.value = PLAY_MODES[(i + 1) % PLAY_MODES.length]
    void useSettingsStore().update({ player: { playMode: playMode.value } })
  }

  /** 切换播放音质：写入首选音质设置，并按当前进度重新解析当前曲目（缺该档位时自动回退） */
  async function changeQuality(q: QualityId): Promise<void> {
    await useSettingsStore().update({ player: { preferredQuality: q } })
    const item = current.value
    if (!item) return
    await loadForResume(item, currentTime.value, playing.value)
  }

  return {
    devices,
    deviceError,
    refreshDevices,
    sleepRemaining,
    sleepWaitForEnd,
    stopAfterTrack,
    setSleep,
    cancelSleep,
    isDisliked,
    dislike,
    current,
    queue,
    index,
    queueSource,
    playing,
    playMode,
    currentTime,
    duration,
    loading,
    error,
    volume,
    muted,
    quality,
    enableAudioSpectrum,
    getSpectrumData,
    playItem,
    playInTrial,
    playNext,
    appendToQueue,
    removeFromQueue,
    toggle,
    play,
    pause,
    seek,
    next,
    prev,
    setVolume,
    toggleMute,
    cyclePlayMode,
    playbackRate,
    previewPlaybackRate,
    changeQuality,
    restore,
    onTrackEvent
  }
})
