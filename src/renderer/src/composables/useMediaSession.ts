import { watch } from 'vue'
import { storeToRefs } from 'pinia'
import { usePlayerStore } from '../stores/player'

/**
 * 系统媒体控制：用 Web `navigator.mediaSession`（Chromium 自动桥接 Windows SMTC / macOS NowPlaying）。
 * 照 lx-music-desktop 的 useMediaSessionInfo；坤音已有真实 <audio> 驱动，无需静音保活。
 *
 * 在应用根组件挂载时调用一次即可。
 */
export function useMediaSession(): void {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return

  const player = usePlayerStore()
  const { current, playing, currentTime, duration } = storeToRefs(player)

  const ms = navigator.mediaSession

  function updateMetadata(): void {
    const c = current.value
    if (!c) {
      ms.metadata = null
      return
    }
    ms.metadata = new MediaMetadata({
      title: c.title,
      artist: c.artist,
      album: c.album,
      artwork: c.cover ? [{ src: c.cover }] : []
    })
  }

  function updatePositionState(): void {
    const dur = duration.value / 1000
    if (!Number.isFinite(dur) || dur <= 0) return
    try {
      ms.setPositionState({
        duration: dur,
        position: Math.min(currentTime.value / 1000, dur),
        playbackRate: 1
      })
    } catch {
      /* setPositionState 对非法值抛错，忽略 */
    }
  }

  // 动作处理器 → player store
  ms.setActionHandler('play', () => player.toggle())
  ms.setActionHandler('pause', () => player.toggle())
  ms.setActionHandler('previoustrack', () => player.prev())
  ms.setActionHandler('nexttrack', () => player.next())
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

  // 主进程全局媒体键 / 托盘命令 → player
  window.api.media.onCommand((cmd) => {
    if (cmd === 'playpause') player.toggle()
    else if (cmd === 'next') player.next()
    else if (cmd === 'prev') player.prev()
  })

  watch(current, updateMetadata, { immediate: true })
  watch(playing, (p) => {
    ms.playbackState = p ? 'playing' : 'paused'
  })
  watch(duration, updatePositionState)
  // 进度大跳变（seek）时同步一次；平稳播放交给系统外推，避免高频调用
  let last = 0
  watch(currentTime, (t) => {
    if (Math.abs(t - last) > 1500) updatePositionState()
    last = t
  })
}
