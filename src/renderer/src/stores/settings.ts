import { defineStore } from 'pinia'
import { ref } from 'vue'
import { DEFAULT_SETTINGS, type AppSettings, type DeepPartial } from '@common'
import { applyTheme } from '../theme/apply'

export const useSettingsStore = defineStore('settings', () => {
  const settings = ref<AppSettings>(structuredClone(DEFAULT_SETTINGS))
  let unsubscribe: (() => void) | null = null

  /** 启动加载：拉取主进程设置、应用主题，并订阅变更广播 */
  async function load(): Promise<void> {
    settings.value = await window.api.settings.get()
    applyTheme(settings.value.appearance.themeId)
    if (!unsubscribe) {
      unsubscribe = window.api.settings.onChange((next) => {
        settings.value = next
      })
    }
  }

  /** 局部更新（持久化在主进程完成） */
  async function update(patch: DeepPartial<AppSettings>): Promise<void> {
    settings.value = await window.api.settings.set(patch)
  }

  return { settings, load, update }
})
