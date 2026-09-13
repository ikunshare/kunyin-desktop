import { createApp } from 'vue'
import DesktopLyrics from './desktop-lyrics/DesktopLyrics.vue'
import { createLogger, installGlobalErrorHandlers, setLogSide } from './utils/logger'

// 歌词窗口独立于主窗口，日志里必须能分辨是哪个窗口出的问题
setLogSide('lyric-window')
installGlobalErrorHandlers()

const log = createLogger('vue')
const app = createApp(DesktopLyrics)
app.config.errorHandler = (err, _instance, info) => log.error('组件错误', err, { hook: info })
app.mount('#app')
