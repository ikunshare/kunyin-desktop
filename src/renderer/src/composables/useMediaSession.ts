import { watch } from 'vue'
import { storeToRefs } from 'pinia'
import { usePlayerStore } from '../stores/player'
import { coverUrl } from '../utils/cover'

/**
 * 系统媒体控制（SMTC / 耳机线控 / 系统媒体键）：
 * 用 Web `navigator.mediaSession`（Chromium 自动桥接 Windows SMTC / macOS NowPlaying），
 * 播放中的 <audio> 会被系统识别为媒体源，耳机的播放/暂停/上一首/下一首按钮经 SMTC
 * 回投到这里，再转成 player store 的动作。
 *
 * 与主进程 media 模块（globalShortcut 键盘媒体键 + 托盘）互补：键盘媒体键走主进程
 * MEDIA_COMMAND，蓝牙耳机 AVRCP 与系统媒体弹窗走本模块的 SMTC。
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
      ms.playbackState = 'none'
      return
    }
    const artwork = coverUrl(c.cover)
    ms.metadata = new MediaMetadata({
      title: c.title,
      artist: c.artist,
      album: c.album,
      artwork: artwork ? [{ src: artwork }] : []
    })
  }

  function syncPlaybackState(): void {
    ms.playbackState = playing.value ? 'playing' : 'paused'
    // 同步给主进程，刷新任务栏缩略图工具栏的播放/暂停按钮
    window.api.media.setState(playing.value)
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

  // 动作处理器 → player store。play/pause 用精确语义（按真实播放态判断），
  // 避免 SMTC 状态与 <audio> 短暂失配时「按播放却暂停」的反直觉行为。
  ms.setActionHandler('play', () => {
    if (!playing.value) player.toggle()
  })
  ms.setActionHandler('pause', () => {
    if (playing.value) player.toggle()
  })
  ms.setActionHandler('previoustrack', () => player.prev())
  ms.setActionHandler('nexttrack', () => player.next())
  ms.setActionHandler('stop', () => {
    if (playing.value) player.toggle()
  })
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
  // immediate：启动恢复/首曲播放时立刻同步播放态，保证 SMTC 一开始就处于正确状态
  watch(playing, syncPlaybackState, { immediate: true })
  watch(duration, updatePositionState)
  // 进度大跳变（seek）时同步一次；平稳播放交给系统外推，避免高频调用
  let last = 0
  watch(currentTime, (t) => {
    if (Math.abs(t - last) > 1500) updatePositionState()
    last = t
  })
}
