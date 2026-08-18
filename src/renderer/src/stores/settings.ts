import { defineStore } from 'pinia'
import { ref } from 'vue'
import { DEFAULT_SETTINGS, WINDOW_SIZE_LIST, type AppSettings, type DeepPartial } from '@common'
import { applyTheme, setCustomThemes } from '../theme/apply'
import { applyAppFont } from '../composables/useFonts'

/** 界面字体大小 → #app 整体缩放（本应用样式以 px 为主，html font-size 无效，用 zoom 实现 LX 的字体大小档位）。
 * 只写 --app-zoom 变量，实际 zoom 与尺寸反向补偿由 base.css 的 #app 规则处理，避免背景图溢出/底部露白。 */
function applyFontZoom(fontSize: number): void {
  document.documentElement.style.setProperty('--app-zoom', String(fontSize / 16))
}

// 上次已应用的窗口尺寸档位；仅在实际变化时才 setSize，避免覆盖用户手动拉伸的窗口
let lastWindowSizeId: number | null = null

/** 把外观类设置应用到 DOM（主题变量 + 字体 + 缩放）。幂等，可在任意变更后重放。 */
function applyAppearance(s: AppSettings): void {
  setCustomThemes(s.appearance.customThemes)
  applyTheme(s.appearance.themeId, s.appearance.lightThemeId, s.appearance.darkThemeId)
  applyAppFont(s.appearance.appFont)
  applyFontZoom(s.appearance.fontSize)
  if (lastWindowSizeId !== null && lastWindowSizeId !== s.appearance.windowSizeId) {
    const conf = WINDOW_SIZE_LIST.find((i) => i.id === s.appearance.windowSizeId)
    if (conf) void window.api.window.setSize(conf.width, conf.height)
  }
  lastWindowSizeId = s.appearance.windowSizeId
}

/** 同 lx-music-desktop 的 disableAnimation：关闭后即时停用全局 CSS 动画与过渡。 */
function applyBehavior(s: AppSettings): void {
  document.documentElement.classList.toggle('disable-animation', !s.behavior.showAnimation)
}

export const useSettingsStore = defineStore('settings', () => {
  const settings = ref<AppSettings>(structuredClone(DEFAULT_SETTINGS))
  let unsubscribe: (() => void) | null = null

  /** 启动加载：拉取主进程设置、应用主题与字体，并订阅变更广播 */
  async function load(): Promise<void> {
    settings.value = await window.api.settings.get()
    applyAppearance(settings.value)
    applyBehavior(settings.value)
    if (!unsubscribe) {
      unsubscribe = window.api.settings.onChange((next) => {
        settings.value = next
        applyAppearance(next)
        applyBehavior(next)
      })
    }
  }

  /** 局部更新（持久化在主进程完成） */
  async function update(patch: DeepPartial<AppSettings>): Promise<void> {
    settings.value = await window.api.settings.set(patch)
    applyAppearance(settings.value)
    applyBehavior(settings.value)
  }

  return { settings, load, update }
})
