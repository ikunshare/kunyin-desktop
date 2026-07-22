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
  })
  audio.addEventListener('durationchange', () => {
    duration.value = Number.isFinite(audio.duration) ? Math.floor(audio.duration * 1000) : 0
  })
  audio.addEventListener('play', () => (playing.value = true))
  audio.addEventListener('pause', () => (playing.value = false))
  audio.addEventListener('ended', () => next())

  /** 音质尝试顺序：优先设置项，其余从低到高兜底（高音质常需卡密） */
  function qualityOrder(item: MusicItem): string[] {
    const preferred = useSettingsStore().settings.player.preferredQuality
    const order: string[] = []
    if (item.qualities[preferred]) order.push(preferred)
    for (const q of QUALITY_LADDER) if (item.qualities[q] && !order.includes(q)) order.push(q)
    for (const q of Object.keys(item.qualities)) if (!order.includes(q)) order.push(q)
    return order.length ? order : ['128k']
  }

  async function loadAndPlay(item: MusicItem): Promise<void> {
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
        if (current.value !== item) return // 已切歌
        if (res.ok) {
          audio.src = res.url
          audio.volume = muted.value ? 0 : volume.value
          await audio.play().catch(() => {})
          loading.value = false
          return
        }
        lastReason = res.reason ?? ''
      }
      error.value = lastReason || '无法播放'
      playing.value = false
    } finally {
      loading.value = false
    }
  }

  /**
   * 播放一首歌。
   * @param list 设为播放队列（浏览页传搜索/歌单结果）
   * @param opts.trackTrial 是否把该曲累积进「试听列表」（对齐 Android：搜索/专辑/歌手点单曲时累积）。
   *   从试听列表自身播放时应传 false，避免自我扰动。默认 false（不动试听列表）。
   */
  function playItem(item: MusicItem, list?: MusicItem[], opts?: { trackTrial?: boolean }): void {
    current.value = item
    if (list) {
      queue.value = list
      index.value = list.indexOf(item)
    }
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
    playItem,
    playNext,
    toggle,
    seek,
    next,
    prev,
    setVolume,
    toggleMute,
    cyclePlayMode
  }
})
