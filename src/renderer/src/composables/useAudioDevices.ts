import { ref, watch, type Ref } from 'vue'
import { useSettingsStore } from '../stores/settings'

export function useAudioDevices(
  audio: HTMLAudioElement,
  pause: () => void
): {
  devices: Ref<MediaDeviceInfo[]>
  deviceError: Ref<string>
  refreshDevices: () => Promise<void>
} {
  const store = useSettingsStore()
  const devices = ref<MediaDeviceInfo[]>([])
  const deviceError = ref('')
  let previous: string[] | null = null
  let activeId = 'default'
  let sequence = 0
  async function refreshDevices(): Promise<void> {
    if (!navigator.mediaDevices?.enumerateDevices) return
    try {
      const next = (await navigator.mediaDevices.enumerateDevices()).filter(
        (item) => item.kind === 'audiooutput'
      )
      const ids = next.map((item) => item.deviceId + ':' + item.label)
      if (
        previous &&
        store.settings.player.pauseOnDeviceChange &&
        previous.some((id) => !ids.includes(id))
      )
        pause()
      previous = ids
      devices.value = next
      if (activeId !== 'default' && !next.some((item) => item.deviceId === activeId)) {
        pause()
        await audio.setSinkId('default')
        activeId = 'default'
        deviceError.value = '所选输出设备已断开，已切回系统默认设备'
      }
    } catch (e) {
      deviceError.value = e instanceof Error ? e.message : '无法读取音频设备'
    }
  }
  watch(
    () => store.settings.player.outputDeviceId,
    async (id) => {
      const token = ++sequence
      try {
        if (!audio.setSinkId) {
          if (id !== 'default') deviceError.value = '当前系统不支持选择输出设备'
          return
        }
        await audio.setSinkId(id || 'default')
        if (token !== sequence) return
        activeId = id || 'default'
        deviceError.value = ''
      } catch {
        if (token !== sequence) return
        deviceError.value = '输出设备不可用，已使用系统默认设备'
        await audio.setSinkId('default').catch(() => {})
        activeId = 'default'
      }
    },
    { immediate: true }
  )
  navigator.mediaDevices?.addEventListener('devicechange', () => void refreshDevices())
  void refreshDevices()
  return { devices, deviceError, refreshDevices }
}
