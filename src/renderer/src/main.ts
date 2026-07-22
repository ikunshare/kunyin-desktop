import './assets/main.css'

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { router } from './router'
import { initTheme } from './theme/apply'

// OS class + 语言（驱动字体栈），并同步注入默认主题变量（首屏无闪烁）
const platform = navigator.platform.toLowerCase()
document.documentElement.classList.add(
  platform.includes('mac') ? 'mac' : platform.includes('linux') ? 'linux' : 'windows'
)
document.documentElement.lang = 'zh-Hans'
initTheme('green')

createApp(App).use(createPinia()).use(router).mount('#app')
