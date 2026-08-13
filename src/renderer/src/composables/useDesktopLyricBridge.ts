import { onUnmounted, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { usePlayerStore } from '../stores/player'
import { useSettingsStore } from '../stores/settings'
import type { DesktopLyricState, Lyric } from '@common'

/**
 * 桌面歌词桥：主窗口侧全程运行，把当前歌词/进度/播放态推送给桌面歌词悬浮窗（经主进程转发）。
 * 独立于 PlayerView 是否打开——切歌时拉一次歌词并缓存，进度变化时只推时间。
 *
 * 仅当 settings.lyrics.desktopEnabled 时才拉歌词/推送，省开销。
 */
export function useDesktopLyricBridge(): void {
  const player = usePlayerStore()
  const settings = useSettingsStore()
  const { current, playing, currentTime } = storeToRefs(player)

  let cached: Lyric | null = null
  let loadToken = 0

  function enabled(): boolean {
    return settings.settings.lyrics.desktopEnabled
  }

  function push(): void {
    if (!enabled()) return
    const c = current.value
    const hasLyric = !!(cached && (cached.char || cached.lrc))
    const state: DesktopLyricState = {
      hasLyric,
      lyric: cached ? cached.char || cached.lrc : '',
      translate: cached?.trans ?? '',
      roman: (cached?.chroma || cached?.roma) ?? '',
      currentTime: currentTime.value,
      playing: playing.value,
      spectrum: settings.settings.lyrics.desktopAudioVisualization ? player.getSpectrumData() : [],
      title: c ? `${c.title} - ${c.artist}` : '',
      musicName: c?.title,
      musicSinger: c?.artist ? [c.artist] : []
    }
    window.api.desktopLyric.push(state)
  }

  async function loadLyric(): Promise<void> {
    const token = ++loadToken
    cached = null
    if (!current.value || !enabled()) {
      push()
      return
    }
    try {
      const plain = JSON.parse(JSON.stringify(current.value))
      const ly = await window.api.player.lyric(plain)
      if (token !== loadToken) return
      cached = ly
    } catch {
      cached = null
    }
    push()
  }

  let spectrumTimer: ReturnType<typeof setInterval> | null = null
  function syncSpectrumTimer(): void {
    if (spectrumTimer) clearInterval(spectrumTimer)
    spectrumTimer = null
    if (
      settings.settings.lyrics.desktopEnabled &&
      settings.settings.lyrics.desktopAudioVisualization
    ) {
      // 约 12.5 fps：频谱足够顺滑，同时避免跨窗口 IPC 占用过高。
      spectrumTimer = setInterval(push, 80)
    }
  }

  watch(current, () => void loadLyric())
  watch(playing, push)
  // 频谱开启时由 80ms 定时器连同进度一起推；关闭时沿用 <audio> timeupdate（约 4/s）。
  watch(currentTime, () => {
    if (!settings.settings.lyrics.desktopAudioVisualization) push()
  })
  // 开关打开时立即拉一次；频谱开关变化时启动/停止采样推送。
  watch(
    () => settings.settings.lyrics.desktopEnabled,
    (on) => {
      if (on) void loadLyric()
      syncSpectrumTimer()
    }
  )
  watch(() => settings.settings.lyrics.desktopAudioVisualization, syncSpectrumTimer)
  syncSpectrumTimer()

  onUnmounted(() => {
    if (spectrumTimer) clearInterval(spectrumTimer)
  })
}
