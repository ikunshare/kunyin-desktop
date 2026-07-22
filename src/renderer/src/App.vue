<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { useSettingsStore } from './stores/settings'
import { useLibraryStore } from './stores/library'
import { useDownloadStore } from './stores/download'
import { useMediaSession } from './composables/useMediaSession'
import { useDesktopLyricBridge } from './composables/useDesktopLyricBridge'
import MvPlayer from './components/MvPlayer.vue'

const settings = useSettingsStore()
const library = useLibraryStore()
const download = useDownloadStore()
const unsubs: (() => void)[] = []

// 系统媒体控制（Web MediaSession → SMTC），全程有效
useMediaSession()
// 桌面歌词桥：把歌词/进度推给悬浮窗
useDesktopLyricBridge()

onMounted(() => {
  void settings.load()
  void library.refresh()
  void download.refresh()
  unsubs.push(library.subscribe(), download.subscribe())
})

onUnmounted(() => {
  unsubs.forEach((u) => u())
})
</script>

<template>
  <RouterView />
  <MvPlayer />
</template>
