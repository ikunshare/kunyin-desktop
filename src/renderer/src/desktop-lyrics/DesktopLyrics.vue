<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref } from 'vue'
import { useLyricPlayer } from '../composables/useLyricPlayer'
import type { AppSettings, DesktopLyricState } from '@common'

// 复用主窗口同款逐字歌词引擎（纯 DOM）
const host = ref<HTMLElement>()
const lyric = useLyricPlayer()
const hasLyric = ref(false)
const title = ref('')
const locked = ref(false)

// 用户可配置的外观（来自 settings.lyrics）
const fontSize = ref(28)
const bgOpacity = ref(0.28)

let lastLyricKey = ''
let lastTime = 0

function applyAppearance(s: AppSettings): void {
  const ly = s.lyrics
  fontSize.value = ly.desktopFontSize || 28
  bgOpacity.value = typeof ly.desktopBgOpacity === 'number' ? ly.desktopBgOpacity : 0.28
  lyric.setColors(ly.desktopColorNormal || '#ffffff', ly.desktopColorActive || '#4daf7c')
  lyric.setAnnotationVisible({
    translation: ly.showTranslation,
    romanization: ly.showRomanization
  })
}

async function apply(state: DesktopLyricState): Promise<void> {
  title.value = state.title
  const key = state.lyric + ' ' + state.translate + ' ' + state.roman
  if (key !== lastLyricKey) {
    lastLyricKey = key
    if (state.hasLyric && state.lyric) {
      hasLyric.value = true
      await nextTick()
      lyric.loadLyric(state.lyric, state.translate, state.roman)
      await nextTick()
      requestAnimationFrame(() => lyric.relayout())
    } else {
      lyric.clear()
      hasLyric.value = false
    }
  }
  if (!hasLyric.value) return
  if (state.playing) {
    if (Math.abs(state.currentTime - lastTime) > 400) lyric.play(state.currentTime)
  } else {
    lyric.seekMs(state.currentTime)
  }
  lastTime = state.currentTime
}

let unsub: (() => void) | null = null
let settingsUnsub: (() => void) | null = null

onMounted(async () => {
  host.value?.appendChild(lyric.element.value)
  unsub = window.api.desktopLyric.onState(apply)
  // 读取并订阅外观设置
  applyAppearance(await window.api.settings.get())
  settingsUnsub = window.api.settings.onChange(applyAppearance)
})
onUnmounted(() => {
  unsub?.()
  settingsUnsub?.()
})

function toggleLock(): void {
  locked.value = !locked.value
  window.api.desktopLyric.setLock(locked.value)
}
function close(): void {
  void window.api.desktopLyric.toggle(false)
}
</script>

<template>
  <div
    class="dl-root"
    :class="{ locked }"
    :style="{
      background: locked ? 'transparent' : `rgba(0, 0, 0, ${bgOpacity})`,
      '--dl-font-size': fontSize + 'px'
    }"
  >
    <!-- 拖动区（锁定时点击穿透，此条不可拖） -->
    <div class="dl-bar">
      <div class="dl-drag" />
      <div class="dl-actions">
        <button class="dl-btn" :title="locked ? '解锁' : '锁定'" @click="toggleLock">
          {{ locked ? '🔒' : '🔓' }}
        </button>
        <button class="dl-btn" title="关闭" @click="close">✕</button>
      </div>
    </div>
    <div ref="host" class="dl-lyric" :class="{ hidden: !hasLyric }" />
    <div v-if="!hasLyric" class="dl-placeholder">{{ title || '坤音 · 桌面歌词' }}</div>
  </div>
</template>

<style scoped>
.dl-root {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  color: #fff;
  border-radius: 12px;
  /* 背景色由内联 style 按 bgOpacity 控制 */
  backdrop-filter: blur(6px);
  overflow: hidden;
}
.dl-root.locked {
  backdrop-filter: none;
}
.dl-bar {
  flex: none;
  height: 26px;
  display: flex;
  align-items: center;
  padding: 0 6px;
  opacity: 0;
  transition: opacity 0.2s ease;
}
.dl-root:hover .dl-bar {
  opacity: 1;
}
.dl-root.locked .dl-bar {
  display: none;
}
.dl-drag {
  flex: 1;
  height: 100%;
  -webkit-app-region: drag;
}
.dl-actions {
  flex: none;
  display: flex;
  gap: 4px;
}
.dl-btn {
  -webkit-app-region: no-drag;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 4px;
  font-size: 12px;
  color: #fff;
  background: rgba(255, 255, 255, 0.15);
  cursor: pointer;
}
.dl-btn:hover {
  background: rgba(255, 255, 255, 0.3);
}
.dl-lyric {
  flex: 1;
  min-height: 0;
  font-size: var(--dl-font-size, 28px);
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.6);
  position: relative;
}
.dl-lyric.hidden {
  visibility: hidden;
  pointer-events: none;
  position: absolute;
  inset: 26px 0 0 0;
}
.dl-lyric :deep([data-role='line-normal']) {
  row-gap: 10px !important;
}
/* 汉字紧排：逐字音译 absolute，不按拼音宽度撑开每个字 */
.dl-lyric :deep([data-role='line-normal-text-word']) {
  --word-gap: 0px !important;
  position: relative;
  overflow: visible;
}
.dl-lyric :deep([data-role='line-normal-text-word-roman']) {
  position: absolute !important;
  left: 50%;
  top: 100%;
  transform: translateX(-50%);
  width: max-content;
  max-width: none;
  white-space: nowrap;
  line-height: 1.15;
  pointer-events: none;
  font-weight: 400 !important;
}
.dl-lyric :deep([data-role='line-normal-annotation-translation']),
.dl-lyric :deep([data-role='line-normal-annotation-romanization']) {
  display: block !important;
  position: relative !important;
  line-height: 1.35;
  margin: 0;
  font-weight: 400 !important;
}
.dl-placeholder {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  color: rgba(255, 255, 255, 0.7);
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.6);
}
</style>
