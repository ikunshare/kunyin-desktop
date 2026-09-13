import './assets/main.css'

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import type { AppSettings } from '@common'
import App from './App.vue'
import { router, getLastRoute } from './router'
import { applyTheme, initTheme, setCustomThemes } from './theme/apply'
import { applyAppFont } from './composables/useFonts'
import { createLogger, installGlobalErrorHandlers } from './utils/logger'

// 尽可能早：入口脚本本身出错也要留下记录。此刻设置未载入，先按默认 info 级别，
// settings store 载入后会调 setRendererLogLevel 校准。
installGlobalErrorHandlers()

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

const log = createLogger('vue')
const app = createApp(App).use(createPinia()).use(router)

// Vue 组件内抛出的错误默认只在控制台留一行，Release 下等于没有；统一进日志文件
app.config.errorHandler = (err, _instance, info) => {
  log.error('组件错误', err, { hook: info })
}
app.config.warnHandler = (msg, _instance, trace) => {
  log.warn('组件警告', { msg, trace: trace.slice(0, 600) })
}
router.onError((err, to) => {
  log.error('路由跳转失败', err, { to: to.fullPath })
})

// 恢复上次停留的页面（在挂载前排队导航，router.isReady 会以它为准）
const lastRoute = getLastRoute()
if (lastRoute) void router.replace(lastRoute)
app.mount('#app')
log.info('渲染层已挂载', { route: lastRoute ?? '/', zoom: initialAppearance?.fontSize ?? 16 })
