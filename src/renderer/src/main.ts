import './assets/main.css'

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import type { AppSettings } from '@common'
import App from './App.vue'
import { router, getLastRoute } from './router'
import { applyTheme, initTheme, setCustomThemes } from './theme/apply'
import { applyAppFont } from './composables/useFonts'

// OS class + 语言（驱动字体栈），并同步注入主题变量（首屏无闪烁）。
// preload 已同步读取 settings.json 的外观段；读不到时回退默认绿色。
const platform = navigator.platform.toLowerCase()
document.documentElement.classList.add(
  platform.includes('mac') ? 'mac' : platform.includes('linux') ? 'linux' : 'windows'
)
document.documentElement.lang = 'zh-Hans'

const initialAppearance = (
  window as unknown as { __INITIAL_APPEARANCE__?: AppSettings['appearance'] | null }
).__INITIAL_APPEARANCE__
if (initialAppearance) {
  setCustomThemes(initialAppearance.customThemes ?? [])
  applyTheme(
    initialAppearance.themeId ?? 'green',
    initialAppearance.lightThemeId ?? 'green',
    initialAppearance.darkThemeId ?? 'black'
  )
  // 缩放/字体也同步注入，避免 settings.load 回来后窗口已可见再发生布局跳变
  document.documentElement.style.setProperty(
    '--app-zoom',
    String((initialAppearance.fontSize ?? 16) / 16)
  )
  applyAppFont(initialAppearance.appFont ?? '')
} else {
  initTheme('green')
}

const app = createApp(App).use(createPinia()).use(router)
// 恢复上次停留的页面（在挂载前排队导航，router.isReady 会以它为准）
const lastRoute = getLastRoute()
if (lastRoute) void router.replace(lastRoute)
app.mount('#app')
