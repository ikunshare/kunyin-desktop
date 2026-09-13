<script setup lang="ts">
import { nextTick, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useSettingsStore } from './stores/settings'
import { useLibraryStore } from './stores/library'
import { useDownloadStore } from './stores/download'
import { usePlayerStore } from './stores/player'
import { useMediaSession } from './composables/useMediaSession'
import { useDesktopLyricBridge } from './composables/useDesktopLyricBridge'
import { useQqListenReport } from './composables/useQqListenReport'
import { usePopupAnimation } from './composables/usePopupAnimation'
import { useApi } from './composables/useApi'
import { currentBackgroundImageUrl } from './theme/apply'
import MvPlayer from './components/MvPlayer.vue'

const api = useApi()
const router = useRouter()
const settings = useSettingsStore()
const library = useLibraryStore()
const download = useDownloadStore()
const player = usePlayerStore()
const unsubs: (() => void)[] = []

// 系统媒体控制（Web MediaSession → SMTC），全程有效
useMediaSession()
// 桌面歌词桥：把歌词/进度推给悬浮窗
useDesktopLyricBridge()
// QQ 音乐听歌上报（登录 + 设置开启时生效）
useQqListenReport()
// 各弹窗保持原组件结构，通过 DOM 观察统一获得 LX 风格（可随机）的入场动画。
usePopupAnimation(
  () => settings.settings.behavior.showAnimation,
  () => settings.settings.behavior.randomAnimation
)

function applyFullscreenState(fullscreen: boolean): void {
  document.documentElement.classList.toggle('fullscreen', fullscreen)
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'F11') return
  event.preventDefault()
  void api.window.fullscreen().then((current) => api.window.fullscreen(!current))
}

// 通知主进程显示窗口。三个条件都满足才上报：
// 1. router.isReady —— Vue Router 初始导航是异步的，onMounted 时 RouterView 仍是空占位，
//    此刻 #app 上只有主题背景图（无图主题即白底）铺满全窗，外壳渲染后才把它盖住
//    （启动"背景图/白屏一闪而过"的根因），必须等 MainLayout 就位；
// 2. 主题背景图已预载并解码 —— 窗口可见后图片不会再弹入/闪动；
// 3. 双 rAF —— 上述内容已真实绘制一帧。
function notifyWindowReady(): void {
  let done = false
  const finish = (): void => {
    if (done) return
    done = true
    requestAnimationFrame(() => {
      requestAnimationFrame(() => api.window.ready())
    })
  }
  const url = currentBackgroundImageUrl()
  if (!url) {
    finish()
    return
  }
  const img = new Image()
  try {
    img.src = url
    void img.decode().then(finish, finish)
  } catch {
    finish()
  }
  setTimeout(finish, 1500) // 兜底：加载异常不阻塞窗口显示
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  unsubs.push(api.window.onFullscreenChange(applyFullscreenState))
  void api.window.fullscreen().then(applyFullscreenState)
  void settings.load()
  void library.refresh()
  void download.refresh()
  unsubs.push(library.subscribe(), download.subscribe())

  // 恢复上次播放的歌曲/队列/进度（异步解析直链 + seek，不阻塞窗口显示）
  void player.restore()

  void router.isReady().then(() => nextTick(notifyWindowReady))
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  unsubs.forEach((u) => u())
})
</script>

<template>
  <RouterView />
  <MvPlayer />
</template>
