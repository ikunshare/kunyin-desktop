<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useSettingsStore } from '../../../stores/settings'
import { buildThemeColors, customToThemeDef, THEMES, type ThemeDef } from '../../../theme/themes'

// 跟随系统主题设置弹窗（lx-music-desktop 右键"跟随系统"弹出的主题预选框）：
// 亮色/暗色各预选一个主题，系统深浅切换时自动应用对应主题。
defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: boolean): void }>()

const store = useSettingsStore()
const { settings } = storeToRefs(store)

const defs = computed<ThemeDef[]>(() => [
  ...THEMES,
  ...settings.value.appearance.customThemes.map(customToThemeDef)
])
const lightThemes = computed(() => defs.value.filter((t) => !t.isDark))
const darkThemes = computed(() => defs.value.filter((t) => t.isDark))

function previewStyles(t: ThemeDef): Record<string, string> {
  return {
    '--color-primary-theme': buildThemeColors(t)['--color-theme'] ?? t.primary,
    '--background-image-theme': t.ext['--background-image'] ?? 'none'
  }
}

const lightId = computed(() => settings.value.appearance.lightThemeId)
const darkId = computed(() => settings.value.appearance.darkThemeId)

function setLight(id: string): void {
  if (lightId.value === id) return
  void store.update({ appearance: { lightThemeId: id } })
}
function setDark(id: string): void {
  if (darkId.value === id) return
  void store.update({ appearance: { darkThemeId: id } })
}
</script>

<template>
  <div v-if="modelValue" class="mask" @click.self="emit('update:modelValue', false)">
    <div class="dialog">
      <div class="toolbar">
        <button class="close" title="关闭" @click="emit('update:modelValue', false)">✕</button>
      </div>
      <h3 class="title">跟随系统主题设置</h3>
      <div class="body">
        <p class="group-label">亮色主题</p>
        <ul class="grid">
          <li
            v-for="t in lightThemes"
            :key="t.id"
            class="item"
            :class="{ active: lightId === t.id }"
            :style="previewStyles(t)"
            :aria-label="t.name"
            @click="setLight(t.id)"
          >
            <div class="bg" />
            <span class="label">{{ t.name }}</span>
          </li>
        </ul>
        <p class="group-label">暗色主题</p>
        <ul class="grid">
          <li
            v-for="t in darkThemes"
            :key="t.id"
            class="item"
            :class="{ active: darkId === t.id }"
            :style="previewStyles(t)"
            :aria-label="t.name"
            @click="setDark(t.id)"
          >
            <div class="bg" />
            <span class="label">{{ t.name }}</span>
          </li>
        </ul>
        <p class="tip">
          注：你可以预先设置一个亮色主题及暗色主题，此后将根据系统的亮、暗主题色自动切换为你预先设置的相应主题。
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mask {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.35);
}
.dialog {
  width: 640px;
  max-width: 90vw;
  border-radius: var(--radius-border);
  background: var(--color-content-background);
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.25);
  overflow: hidden;
}
/* LX 弹窗的主色标题栏 */
.toolbar {
  display: flex;
  justify-content: flex-end;
  padding: 4px 6px;
  background: var(--color-primary);
}
.close {
  padding: 2px 8px;
  color: rgba(255, 255, 255, 0.85);
  font-size: 13px;
  border-radius: var(--form-radius);
  transition: background-color 0.2s ease;
}
.close:hover {
  color: #fff;
  background: rgba(255, 255, 255, 0.18);
}
.title {
  margin: 10px 0 4px;
  text-align: center;
  font-size: 16px;
  font-weight: 600;
  color: var(--color-font);
}
.body {
  max-height: 62vh;
  overflow-y: auto;
  padding: 10px 22px 16px;
}
.group-label {
  margin: 12px 0 10px;
  font-size: 14px;
  color: var(--color-font);
}
.grid {
  display: flex;
  flex-flow: row wrap;
  margin-bottom: -14px;
}
.item {
  display: flex;
  flex-flow: column nowrap;
  align-items: center;
  cursor: pointer;
  margin-right: 14px;
  margin-bottom: 14px;
  width: 76px;
  transition:
    color 0.3s ease,
    opacity 0.3s ease;
}
.item:hover {
  opacity: 0.75;
}
.item.active {
  color: var(--color-primary-font-active);
}
.item.active:hover {
  opacity: 1;
}
.bg {
  display: block;
  width: 52px;
  height: 52px;
  margin-bottom: 6px;
  border: 2px solid transparent;
  padding: 2px;
  border-radius: 8px;
  transition: border-color 0.3s ease;
}
.item.active .bg {
  border-color: var(--color-primary-font-active);
}
.bg::after {
  display: block;
  content: ' ';
  width: 100%;
  height: 100%;
  border-radius: 6px;
  background-position: center;
  background-size: cover;
  background-repeat: no-repeat;
  background-color: var(--color-primary-theme);
  background-image: var(--background-image-theme);
}
.label {
  width: 100%;
  text-align: center;
  height: 1.2em;
  font-size: 12px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.tip {
  margin-top: 14px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--color-font-label);
}
</style>
