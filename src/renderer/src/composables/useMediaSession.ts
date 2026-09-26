import { watch } from 'vue'
import { storeToRefs } from 'pinia'
import { usePlayerStore } from '../stores/player'
import { useSettingsStore } from '../stores/settings'
import { useLibraryStore } from '../stores/library'
import { coverUrl } from '../utils/cover'
import { lineIndexAt, parseLrcLines, type LrcLine } from '../utils/lrcLines'

/**
 * 系统媒体控制（SMTC / 耳机线控 / 系统媒体键）：
 * 用 Web `navigator.mediaSession`（Chromium 自动桥接 Windows SMTC / macOS NowPlaying /
 * Linux MPRIS），播放中的 <audio> 会被系统识别为媒体源，媒体面板与耳机的
 * 播放/暂停/上一首/下一首按钮经此回投到这里，再转成 player store 的动作。
 *
 * Windows/macOS 的键盘媒体键也走这条路（Chromium 的 HardwareMediaKeyHandling 在这两个
 * 平台默认开启，由系统按「当前活跃媒体会话」路由），主进程不再重复注册 globalShortcut
 * ——原因见 src/main/modules/media/index.ts 的说明。主进程只保留托盘与任务栏缩略图
 * 工具栏的 MEDIA_COMMAND。
 * 在应用根组件挂载时调用一次即可。
 */
export function useMediaSession(): void {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return

  const player = usePlayerStore()
  const { current, playing, currentTime, duration } = storeToRefs(player)

  const settings = useSettingsStore()
  const ms = navigator.mediaSession

  /**
   * 蓝牙歌词（settings.lyrics.bluetoothLyric）：当前一句顶替标题上报给系统媒体会话。
   * 车机 / 蓝牙耳机没有自己的歌词通道，AVRCP 只传标题/艺术家/专辑这几个字段，
   * 所以业内做法都是把歌词塞进标题——Windows SMTC、macOS NowPlaying、Linux MPRIS
   * （配 BlueZ mpris-proxy）再经 AVRCP 转给设备。
   */
  let lyricLines: LrcLine[] = []
  let lyricToken = 0
  /** 当前上报出去的歌词行；null = 标题是歌名本身 */
  let shownLine: string | null = null

  function bluetoothLyricOn(): boolean {
    return settings.settings.lyrics.bluetoothLyric
  }

  /** 此刻应作为标题上报的歌词；没开 / 没歌词 / 前奏 / 间奏空行都回落到歌名（null） */
  function lineNow(): string | null {
    if (!bluetoothLyricOn() || !lyricLines.length) return null
    const i = lineIndexAt(lyricLines, currentTime.value)
    return i >= 0 && lyricLines[i].text ? lyricLines[i].text : null
  }

  /**
   * 切歌 / 打开开关时拉一次歌词（主进程有歌词缓存，与播放页、桌面歌词重复拉不会重复触网）。
   * 行表在第一个 await 之前**同步**清空：调用方紧接着刷 metadata 时不会拿上一首的歌词。
   */
  async function loadLyricLines(): Promise<void> {
    const token = ++lyricToken
    lyricLines = []
    const c = current.value
    if (!c || !bluetoothLyricOn()) return
    try {
      const ly = await window.api.player.lyric(JSON.parse(JSON.stringify(c)))
      if (token !== lyricToken) return
      // 主轨 lrc 是逐行 LRC；只有逐字轨的源退而用逐字轨，解析器会剥掉逐字标签
      lyricLines = parseLrcLines(ly.lrc.trim() ? ly.lrc : ly.char)
    } catch {
      return
    }
    syncLyricLine()
  }

  /** 当前行变了才换 metadata——换一次系统面板就重置一次，不能跟着 timeupdate 每秒刷 4 回 */
  function syncLyricLine(): void {
    if (lineNow() !== shownLine) updateMetadata()
  }

  /** 由 URL 后缀推断封面 MIME（推断不出就不报，交给响应头） */
  function artworkType(url: string): string | undefined {
    const ext = /\.(jpe?g|png|webp|gif|bmp)(?:[?#]|$)/i.exec(url)?.[1]?.toLowerCase()
    if (!ext) return undefined
    if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
    return `image/${ext}`
  }

  function updateMetadata(): void {
    const c = current.value
    if (!c) {
      shownLine = null
      ms.metadata = null
      ms.playbackState = 'none'
      return
    }
    const artwork = coverUrl(c.cover)
    const type = artwork ? artworkType(artwork) : undefined
    shownLine = lineNow()
    ms.metadata = new MediaMetadata({
      // 蓝牙歌词：标题换成当前一句，歌名 - 歌手挪进艺术家栏（车机一般只显示这两行）
      title: shownLine ?? c.title,
      artist: shownLine ? [c.title, c.artist].filter(Boolean).join(' - ') : c.artist,
      album: c.album,
      // 缩略图由 Chromium 下载后交给系统。sizes 必须给：Chromium 用 MediaImageManager
      // 按尺寸给候选图打分，无尺寸提示的图评分最低，Windows 侧常表现为「只有文字没封面」。
      // 平台只给单一封面 URL，同一张按常用档位报出即可（系统取实际解码尺寸）。
      artwork: artwork
        ? [
            { src: artwork, sizes: '256x256', ...(type ? { type } : {}) },
            { src: artwork, sizes: '512x512', ...(type ? { type } : {}) }
          ]
        : []
    })
    // 换 MediaMetadata 会让系统媒体面板整体重置一次，必须紧接着把播放态与进度补回去，
    // 否则切歌后面板会停在「暂停 + 上一首的进度」上。
    syncPlaybackState()
    updatePositionState()
  }

  function syncPlaybackState(): void {
    ms.playbackState = !current.value ? 'none' : playing.value ? 'playing' : 'paused'
    // 同步给主进程，刷新任务栏缩略图工具栏的播放/暂停按钮
    window.api.media.setState(playing.value)
  }

  function updatePositionState(): void {
    const dur = duration.value / 1000
    if (!Number.isFinite(dur) || dur <= 0) return
    try {
      ms.setPositionState({
        duration: dur,
        position: Math.min(Math.max(currentTime.value / 1000, 0), dur),
        // 恒为 1：playbackRate 传 0 会被 Chromium 判为非法（TypeError）。
        // 暂停时不外推进度靠 playbackState='paused' 表达，故先同步播放态再报进度。
        playbackRate: settings.settings.player.playbackRate
      })
    } catch {
      /* setPositionState 对非法值抛错，忽略 */
    }
  }

  // 动作处理器 → player store。play/pause 用 store 的幂等实现（按 <audio> 真实状态
  // 判断），SMTC 与线控重复下发同一命令时不会互相抵消。
  ms.setActionHandler('play', () => player.play())
  ms.setActionHandler('pause', () => player.pause())
  ms.setActionHandler('previoustrack', () => player.prev())
  ms.setActionHandler('nexttrack', () => player.next())
  ms.setActionHandler('stop', () => player.pause())
  ms.setActionHandler('seekto', (details) => {
    if (details.seekTime != null) player.seek(details.seekTime * 1000)
  })
  ms.setActionHandler('seekbackward', (details) => {
    const off = (details.seekOffset ?? 5) * 1000
    player.seek(Math.max(0, currentTime.value - off))
  })
  ms.setActionHandler('seekforward', (details) => {
    const off = (details.seekOffset ?? 5) * 1000
    player.seek(currentTime.value + off)
  })

  // 主进程托盘 / 缩略图工具栏命令 → player
  window.api.media.onCommand((cmd) => {
    if (cmd === 'playpause') player.toggle()
    else if (cmd === 'next') player.next()
    else if (cmd === 'prev') player.prev()
    else if (cmd === 'volumeUp') player.setVolume(player.volume + 0.04)
    else if (cmd === 'volumeDown') player.setVolume(player.volume - 0.04)
    else if (cmd === 'mute') player.toggleMute()
    else if (cmd === 'seekForward') player.seek(player.currentTime + 5000)
    else if (cmd === 'seekBackward') player.seek(Math.max(0, player.currentTime - 5000))
    else if (cmd === 'favorite' && player.current)
      void useLibraryStore().toggleFavorite(player.current)
    else if (cmd === 'desktopLyric')
      void window.api.desktopLyric.toggle(!settings.settings.lyrics.desktopEnabled)
  })

  // 蓝牙歌词的行表跟着切歌重拉：先同步清空旧行表再刷 metadata，新歌先报歌名，
  // 歌词到了且唱到第一句时再换成歌词。
  watch(
    current,
    () => {
      void loadLyricLines()
      updateMetadata()
    },
    { immediate: true }
  )
  // 开关变化：关掉时行表已清空，syncLyricLine 把标题换回歌名；打开时等歌词拉回来再换
  watch(
    () => settings.settings.lyrics.bluetoothLyric,
    () => {
      void loadLyricLines()
      syncLyricLine()
    }
  )
  watch(currentTime, () => {
    if (lyricLines.length) syncLyricLine()
  })
  // immediate：启动恢复/首曲播放时立刻同步播放态，保证 SMTC 一开始就处于正确状态。
  // 暂停/恢复时进度也要一并上报——系统按 playbackState 冻结或外推进度，
  // 只改状态不报位置会让面板从一个过期的点继续走。
  watch(
    playing,
    () => {
      syncPlaybackState()
      updatePositionState()
    },
    { immediate: true }
  )
  watch(duration, updatePositionState)
  watch(() => settings.settings.player.playbackRate, updatePositionState)
  // 进度大跳变（seek）时同步一次；平稳播放交给系统外推，避免高频调用
  let last = 0
  watch(currentTime, (t) => {
    if (Math.abs(t - last) > 1500) updatePositionState()
    last = t
  })

  // 任务栏/dock 进度条：1 秒一次就够，timeupdate 每秒 4 次全推过去纯属吵主进程。
  // 开关在主进程侧判（modules/power.ts），这里只管把数推过去。
  let lastProgressAt = 0
  watch(currentTime, (t) => {
    const now = Date.now()
    if (now - lastProgressAt < 1000) return
    lastProgressAt = now
    const dur = duration.value
    window.api.media.setProgress(dur > 0 ? Math.min(1, Math.max(0, t / dur)) : 0)
  })
}
