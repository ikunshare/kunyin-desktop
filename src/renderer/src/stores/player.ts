import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { MusicItem, PlayMode, QualityId } from '@common'
import { getMusicItemKey } from '@common'
import { useSettingsStore } from './settings'

/**
 * 播放器状态 + 真实 <audio> 驱动。
 * 播放地址经主进程自定义协议 kunyin:// 供 <audio>，规避 CSP 与 CDN 鉴权。
 * currentTime/duration 单位为毫秒（与歌词引擎、UI 一致）。
 */
const QUALITY_LADDER: QualityId[] = [
  '128k',
  '320k',
  'flac',
  'hires',
  'master',
  'atmos',
  'atmos_plus'
]
const SPECTRUM_BAR_COUNT = 20

/**
 * 播放队列的来源（哪个列表/试听/单曲）。各列表页据此判断「当前正在播放的队列属于哪里」，
 * 用于展示正在播放的列表标记、提示用户浏览的列表与播放队列不一致。
 * - local   本地歌单（含系统列表：我的收藏/试听列表）
 * - platform 在线歌单/专辑/歌手（id 统一为 `source:id`）
 * - trial   试听列表（搜索点单曲）
 * - single  单曲临时队列（重复歌曲弹窗等）
 */
export interface QueueSource {
  kind: 'local' | 'platform' | 'trial' | 'single'
  id?: string
  name?: string
}

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
  const playMode = ref<PlayMode>('listLoop')
  const currentTime = ref(0)
  const duration = ref(0)
  const loading = ref(false)
  /** 播放地址解析失败原因（如卡密缺失） */
  const error = ref('')
  /** 音量 0..1（初值取设置项，随后本地持久化回设置） */
  const volume = ref(useSettingsStore().settings.player.volume)
  const muted = ref(false)

  const audio = new Audio()
  // kunyin:// 响应带 Access-Control-Allow-Origin；anonymous 让 captureStream 可旁路采样。
  audio.crossOrigin = 'anonymous'
  audio.volume = volume.value

  // 桌面歌词实时频谱使用 captureStream 旁路采样，绝不把原 <audio> 改接到
  // MediaElementAudioSourceNode；后者会接管原输出链路，遇到自定义协议/CORS 时可能直接静音。
  let audioContext: AudioContext | null = null
  let capturedStream: MediaStream | null = null
  let spectrumGraph: { source: MediaStreamAudioSourceNode; sink: GainNode } | null = null
  let analyser: AnalyserNode | null = null
  let spectrumBytes: Uint8Array<ArrayBuffer> | null = null
  let spectrumAttachTimer: ReturnType<typeof setTimeout> | null = null

  function resetSpectrumStream(): void {
    if (spectrumAttachTimer) clearTimeout(spectrumAttachTimer)
    spectrumAttachTimer = null
    spectrumGraph?.source.disconnect()
    analyser?.disconnect()
    spectrumGraph?.sink.disconnect()
    capturedStream = null
    spectrumGraph = null
    analyser = null
    spectrumBytes = null
  }

  function attachSpectrumStream(): void {
    const context = audioContext
    if (!context || context.state !== 'running' || analyser || spectrumGraph) return
    const capture = (
      audio as HTMLAudioElement & {
        captureStream?: () => MediaStream
      }
    ).captureStream
    if (!capture) return
    try {
      if (!capturedStream?.getAudioTracks().length) {
        const stream = capture.call(audio)
        if (!stream.getAudioTracks().length) {
          // playItem 会在设置 src 前预热 AudioContext；此时 captureStream 还没有音轨。
          // 不缓存空流，等 loadeddata/play 事件后重新 capture。
          capturedStream = null
          return
        }
        capturedStream = stream
      }
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

  function getSpectrumData(): number[] {
    const bars = new Array<number>(SPECTRUM_BAR_COUNT).fill(0)
    if (!analyser || !spectrumBytes || audio.paused || audioContext?.state !== 'running')
      return bars
    analyser.getByteFrequencyData(spectrumBytes)
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
  audio.addEventListener('ended', () => next())
  audio.addEventListener('error', () => {
    const item = current.value
    const q = quality.value
    if (!item) return
    // 直链过期/403：使 URL 缓存失效并重试一次当前曲目。
    // 用 loadForResume 从出错位置续播（保持原音质优先）——直链过期多发生在播放中途，
    // 走 loadAndPlay 会把 currentTime 清零从头重播，随后的持久化再把 0 写回存档，进度就丢了。
    if (q && !retriedAfterError) {
      retriedAfterError = true
      void window.api.player.invalidateUrl(JSON.parse(JSON.stringify(item)) as MusicItem, q)
      void loadForResume(item, currentTime.value, playing.value || !audio.paused, q)
      return
    }
    // 重试后仍失败：如实报出来，别只留一条 console 错误
    // MEDIA_ERR_NETWORK/SRC_NOT_SUPPORTED 最常见的成因是代理不可用或直链被拒
    playing.value = false
    loading.value = false
    error.value = describeMediaError(audio.error)
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

  /** 音质尝试顺序：优先设置项，其余从低到高兜底（高音质常需卡密） */
  function qualityOrder(item: MusicItem): string[] {
    const preferred = useSettingsStore().settings.player.preferredQuality
    const order: string[] = []
    if (item.qualities[preferred]) order.push(preferred)
    for (const q of QUALITY_LADDER) if (item.qualities[q] && !order.includes(q)) order.push(q)
    for (const q of Object.keys(item.qualities)) if (!order.includes(q)) order.push(q)
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

  async function loadAndPlay(item: MusicItem): Promise<void> {
    // 每次加载自增：错误重试与用户切歌都会 fire-and-forget 地调本函数，
    // 只靠 isCurrent 挡不住两个实例并发（那只在 await 返回后判一次，
    // 两边都可能通过），结果各自注册一路 kunyin:// 流、各自抢着设 audio.src——
    // DevTools 里就会看到同一首歌冒出多个 token 和一串「已取消」。
    const token = ++loadToken
    const stale = (): boolean => token !== loadToken || !isCurrent(item)

    loading.value = true
    error.value = ''
    currentTime.value = 0
    duration.value = item.duration
    // 过 IPC 需普通对象（Pinia 响应式 Proxy 无法被 structuredClone）
    const plain = JSON.parse(JSON.stringify(item)) as MusicItem
    try {
      let lastReason = ''
      for (const q of qualityOrder(item)) {
        const res = await window.api.player.stream(plain, q)
        if (stale()) return
        if (res.ok) {
          quality.value = q
          audio.src = res.url
          audio.volume = muted.value ? 0 : volume.value
          await audio.play().catch(() => {})
          if (stale()) return
          loading.value = false
          return
        }
        lastReason = res.reason ?? ''
      }
      if (stale()) return
      error.value = lastReason || '无法播放'
      playing.value = false
    } finally {
      // 仅当自己仍是最新一次加载时才清 loading，避免把后继加载的状态覆盖掉
      if (token === loadToken) loading.value = false
    }
  }

  /**
   * 恢复上次会话：加载音频但不自动播放（依设置 autoPlay 决定是否续播），并 seek 到记忆进度。
   * @param preferQuality 优先尝试的音质（恢复会话时传上次实际播放档），失败再走常规顺序
   */
  async function loadForResume(
    item: MusicItem,
    positionMs: number,
    autoplay: boolean,
    preferQuality = ''
  ): Promise<void> {
    // 同 loadAndPlay：启动恢复可能与用户点歌并发，用序号保证只有最后一次生效
    const token = ++loadToken
    const stale = (): boolean => token !== loadToken || !isCurrent(item)

    loading.value = true
    const plain = JSON.parse(JSON.stringify(item)) as MusicItem
    const order =
      preferQuality && item.qualities[preferQuality]
        ? [preferQuality, ...qualityOrder(item).filter((q) => q !== preferQuality)]
        : qualityOrder(item)
    try {
      for (const q of order) {
        const res = await window.api.player.stream(plain, q)
        if (stale()) return
        if (res.ok) {
          quality.value = q
          audio.src = res.url
          audio.volume = muted.value ? 0 : volume.value
          // 等元数据就绪才能 seek；5s 超时兜底
          await new Promise<void>((resolve) => {
            const onMeta = (): void => {
              audio.removeEventListener('loadedmetadata', onMeta)
              resolve()
            }
            audio.addEventListener('loadedmetadata', onMeta)
            setTimeout(() => {
              audio.removeEventListener('loadedmetadata', onMeta)
              resolve()
            }, 5000)
          })
          if (stale()) return
          if (positionMs > 0) seek(positionMs)
          if (autoplay) await audio.play().catch(() => {})
          if (stale()) return
          loading.value = false
          return
        }
      }
      if (stale()) return
      error.value = '无法恢复上次播放'
    } finally {
      if (token === loadToken) loading.value = false
    }
  }

  let restored = false
  /** 启动恢复：读出上次播放的歌曲/队列/进度（App.vue onMounted 调用一次） */
  async function restore(): Promise<void> {
    if (restored) return
    restored = true
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
    muted.value = !!saved.muted
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
    if (useSettingsStore().settings.lyrics.desktopAudioVisualization) enableAudioSpectrum()
    // 过 IPC 需普通对象（Pinia 响应式 Proxy 无法被 structuredClone）
    const plain = JSON.parse(JSON.stringify(item)) as MusicItem
    // 先累积再拉列表：await 串行保证队列里一定包含本曲。
    // 主进程 INSERT OR IGNORE 去重——已存在的歌保持原位，不会被挪到末尾。
    await window.api.library.addToTrial(plain, false).catch(() => {})
    const list = await window.api.library.trialSongs().catch(() => [] as MusicItem[])
    const q = list.length ? list : [plain]
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
    if (audio.paused) void audio.play().catch(() => {})
    else audio.pause()
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
  }

  /**
   * 从播放队列移除一首歌（列表删除歌曲时同步调用）。
   * 删除的是当前播放曲时，立即接播队列「下一首」（队列已空则停止），不再播已删的歌；
   * 删除其他位置的曲只做数组剔除，index 保持指向不变，prev/next 也切不到已删的这首。
   */
  function removeFromQueue(item: MusicItem): void {
    const key = getMusicItemKey(item)
    const idx = queue.value.findIndex((m) => getMusicItemKey(m) === key)
    if (idx < 0) return
    const removingCurrent =
      idx === index.value && !!current.value && getMusicItemKey(current.value) === key
    queue.value.splice(idx, 1)
    if (idx <= index.value) index.value -= 1
    if (index.value < 0) index.value = queue.value.length ? 0 : -1
    schedulePersist()
    if (removingCurrent) {
      if (queue.value.length) step(1) // 删除即切走，忽略 singleLoop 的重播语义
      else audio.pause()
    }
  }

  function seek(ms: number): void {
    if (!current.value) return
    audio.currentTime = Math.max(0, ms) / 1000
    currentTime.value = Math.max(0, ms)
    // 暂停态拖进度条后 timeupdate 不跑、pause 也不会再触发，异常退出就会丢掉新位置
    schedulePersist()
  }

  function step(delta: number): void {
    if (!queue.value.length) return
    const n = queue.value.length
    let i = index.value + delta
    if (playMode.value === 'random') i = Math.floor(Math.random() * n)
    if (i < 0) i = n - 1
    if (i >= n) i = 0
    index.value = i
    // 在队列内切歌不改来源；source 回传保持「正在播放的列表」标记稳定
    playItem(queue.value[i], queue.value, { source: queueSource.value ?? undefined })
  }
  function next(): void {
    if (playMode.value === 'singleLoop' && current.value) {
      seek(0)
      void audio.play().catch(() => {})
      return
    }
    step(1)
  }
  function prev(): void {
    step(-1)
  }

  /** 设音量（0..1），实时应用到 audio 并持久化到设置 */
  function setVolume(v: number): void {
    const clamped = Math.max(0, Math.min(1, v))
    volume.value = clamped
    if (clamped > 0) muted.value = false
    audio.volume = muted.value ? 0 : clamped
    void useSettingsStore().update({ player: { volume: clamped } })
  }
  function toggleMute(): void {
    muted.value = !muted.value
    audio.volume = muted.value ? 0 : volume.value
  }

  const PLAY_MODES: PlayMode[] = ['listLoop', 'singleLoop', 'random']
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
    removeFromQueue,
    toggle,
    seek,
    next,
    prev,
    setVolume,
    toggleMute,
    cyclePlayMode,
    changeQuality,
    restore
  }
})
