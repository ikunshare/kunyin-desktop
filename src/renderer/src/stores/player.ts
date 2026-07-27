import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { MusicItem, PlayMode, QualityId } from '@common'
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
  audio.volume = volume.value
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
  audio.addEventListener('play', () => (playing.value = true))
  audio.addEventListener('pause', () => {
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
   * @param list 设为播放队列（浏览页传搜索/歌单结果）
   * @param opts.trackTrial 是否把该曲累积进「试听列表」（对齐 Android：搜索/专辑/歌手点单曲时累积）。
   *   从试听列表自身播放时应传 false，避免自我扰动。默认 false（不动试听列表）。
   */
  function playItem(item: MusicItem, list?: MusicItem[], opts?: { trackTrial?: boolean }): void {
    current.value = item
    retriedAfterError = false // 用户主动切歌：允许错误重试
    if (list) {
      queue.value = list
      index.value = list.indexOf(item)
    }
    schedulePersist()
    if (opts?.trackTrial) {
      // 追加到试听列表末尾（atHead=false，去重）—— 累积不覆盖、不打乱既有顺序
      const plain = JSON.parse(JSON.stringify(item)) as MusicItem
      void window.api.library.addToTrial(plain, false).catch(() => {})
    }
    void loadAndPlay(item)
  }

  function toggle(): void {
    if (!current.value) return
    if (audio.paused) void audio.play().catch(() => {})
    else audio.pause()
  }

  /**
   * 「下一首播放」：把歌曲插入队列，紧跟当前曲之后，不打断当前播放。
   * 队列为空或未在播放时，直接开始播放该曲。已在队列中的先去重再插入。
   */
  function playNext(item: MusicItem): void {
    if (!current.value || !queue.value.length) {
      playItem(item, [item])
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
    playItem(queue.value[i], queue.value)
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
    playing,
    playMode,
    currentTime,
    duration,
    loading,
    error,
    volume,
    muted,
    quality,
    playItem,
    playNext,
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
