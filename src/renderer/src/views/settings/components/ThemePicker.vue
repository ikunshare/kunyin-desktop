<script setup lang="ts">
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useSettingsStore } from '../../../stores/settings'
import {
  buildThemeColors,
  customToThemeDef,
  findTheme,
  THEMES,
  type ThemeDef
} from '../../../theme/themes'
import AutoThemeDialog from './AutoThemeDialog.vue'
import ThemeEditDialog from './ThemeEditDialog.vue'

// 主题网格选择器。交互移植自 lx-music-desktop SettingBasic.vue 的主题区块：
// 方块预览（主色/背景图）+ 名称，active 描边；'auto' 双色斜切项跟随系统深浅；
// 自定义主题右键编辑，"+" 新建。
const store = useSettingsStore()
const { settings } = storeToRefs(store)

interface ThemeItem {
  def: ThemeDef
  styles: Record<string, string>
}

const customDefs = computed<ThemeDef[]>(() =>
  settings.value.appearance.customThemes.map(customToThemeDef)
)

function themePreviewStyles(t: ThemeDef): Record<string, string> {
  return {
    '--color-primary-theme': buildThemeColors(t)['--color-theme'] ?? t.primary,
    '--background-image-theme': t.ext['--background-image'] ?? 'none'
  }
}

const themeItems = computed<ThemeItem[]>(() =>
  [...THEMES, ...customDefs.value].map((def) => ({ def, styles: themePreviewStyles(def) }))
)

// 'auto' 项的双色斜切预览
const autoStyles = computed<Record<string, string>>(() => {
  const light =
    findTheme(settings.value.appearance.lightThemeId, customDefs.value) ??
    findTheme('green', []) ??
    THEMES[0]
  const dark =
    findTheme(settings.value.appearance.darkThemeId, customDefs.value) ??
    findTheme('black', []) ??
    THEMES[0]
  return {
    '--color-primary-theme-light': buildThemeColors(light)['--color-theme'] ?? light.primary,
    '--background-image-theme-light': light.ext['--background-image'] ?? 'none',
    '--color-primary-theme-dark': buildThemeColors(dark)['--color-theme'] ?? dark.primary,
    '--background-image-theme-dark': dark.ext['--background-image'] ?? 'none'
  }
})

const themeId = computed(() => settings.value.appearance.themeId)

function toggleTheme(id: string): void {
  if (themeId.value === id) return
  void store.update({ appearance: { themeId: id } })
}

// 右键'跟随系统'弹出亮/暗主题预选框（对应 LX 的跟随系统主题设置弹窗）
const showAutoDialog = ref(false)

// 自定义主题编辑
const showEdit = ref(false)
const editThemeId = ref('')
function handleEditTheme(theme?: ThemeDef): void {
  if (theme && !theme.isCustom) return
  editThemeId.value = theme?.id ?? ''
  showEdit.value = true
}
</script>

<template>
  <ul class="theme">
    <li
      v-for="item in themeItems"
      :key="item.def.id"
      class="theme-item"
      :class="{ active: themeId === item.def.id }"
      :style="item.styles"
      :aria-label="item.def.name"
      @click="toggleTheme(item.def.id)"
      @contextmenu="handleEditTheme(item.def)"
    >
      <div class="bg" />
      <span class="label">{{ item.def.name }}</span>
    </li>
    <li
      class="theme-item auto"
      :class="{ active: themeId === 'auto' }"
      :style="autoStyles"
      aria-label="跟随系统"
      @click="toggleTheme('auto')"
      @contextmenu="showAutoDialog = true"
    >
      <div class="bg">
        <div class="bg-content">
          <div class="light" />
          <div class="dark" />
        </div>
      </div>
      <span class="label">跟随系统</span>
    </li>
    <li class="theme-item add" aria-label="添加主题" @click="handleEditTheme()">
      <div class="bg">
        <div class="bg-content">
          <svg class="icon" viewBox="0 0 448 512" aria-hidden="true">
            <path
              fill="currentColor"
              d="M256 80c0-17.7-14.3-32-32-32s-32 14.3-32 32v144H48c-17.7 0-32 14.3-32 32s14.3 32 32 32h144v144c0 17.7 14.3 32 32 32s32-14.3 32-32V288h144c17.7 0 32-14.3 32-32s-14.3-32-32-32H256V80z"
            />
          </svg>
        </div>
      </div>
      <span class="label">添加主题</span>
    </li>
  </ul>
  <AutoThemeDialog v-model="showAutoDialog" />
  <ThemeEditDialog v-model="showEdit" :theme-id="editThemeId" />
</template>

<style scoped>
.theme {
  display: flex;
  flex-flow: row wrap;
  margin-bottom: -18px;
}
.theme-item {
  display: flex;
  flex-flow: column nowrap;
  align-items: center;
  cursor: pointer;
  margin-right: 8px;
  margin-bottom: 18px;
  width: 86px;
  transition:
    color 0.3s ease,
    opacity 0.3s ease;
}
.theme-item:hover {
  opacity: 0.7;
}
.theme-item.active {
  color: var(--color-primary-font-active);
}
.theme-item.active .bg {
  border-color: var(--color-primary-font-active);
}
.theme-item.active:hover {
  opacity: 1;
}
.bg {
  display: block;
  width: 36px;
  height: 36px;
  margin-bottom: 5px;
  border: 2px solid transparent;
  padding: 2px;
  transition: border-color 0.3s ease;
  border-radius: 5px;
}
.bg::after {
  display: block;
  content: ' ';
  width: 100%;
  height: 100%;
  border-radius: var(--radius-border);
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

/* 'auto' 双色斜切 */
.auto .bg::after {
  content: none;
}
.auto .bg-content {
  position: relative;
  height: 100%;
  overflow: hidden;
  border-radius: 5px;
}
.auto .light,
.auto .dark {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
}
.auto .light::after,
.auto .dark::after {
  display: block;
  content: ' ';
  width: 100%;
  height: 100%;
  background-position: center;
  background-size: cover;
  background-repeat: no-repeat;
}
.auto .light::after {
  clip-path: polygon(0 0, 100% 0, 0 100%);
  background-color: var(--color-primary-theme-light);
  background-image: var(--background-image-theme-light);
}
.auto .dark::after {
  clip-path: polygon(0 100%, 100% 0, 100% 100%);
  background-color: var(--color-primary-theme-dark);
  background-image: var(--background-image-theme-dark);
}

/* 添加项 */
.add .bg::after {
  content: none;
}
.add .bg-content {
  box-sizing: border-box;
  border: 1px dashed var(--color-primary-light-100-alpha-300);
  color: var(--color-primary-light-100-alpha-300);
  height: 100%;
  overflow: hidden;
  border-radius: 5px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition:
    border-color 0.3s ease,
    color 0.3s ease;
}
.add .icon {
  width: 50%;
  height: auto;
}
.add .label {
  color: var(--color-primary-dark-100-alpha-300);
}
</style>
