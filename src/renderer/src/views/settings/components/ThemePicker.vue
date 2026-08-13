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

const store = useSettingsStore()
const { settings } = storeToRefs(store)

interface ThemeItem {
  def: ThemeDef
  styles: Record<string, string>
}

const customDefs = computed<ThemeDef[]>(() =>
  settings.value.appearance.customThemes.map(customToThemeDef)
)

function themePreviewStyles(theme: ThemeDef): Record<string, string> {
  return {
    '--color-primary-theme': buildThemeColors(theme)['--color-theme'] ?? theme.primary,
    '--background-image-theme': theme.ext['--background-image'] ?? 'none'
  }
}

const themeItems = computed<ThemeItem[]>(() =>
  [...THEMES, ...customDefs.value].map((def) => ({ def, styles: themePreviewStyles(def) }))
)

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

function themeKind(theme: ThemeDef): string {
  if (theme.isDark) return '深色'
  return theme.ext['--background-image'] !== 'none' ? '插画' : '浅色'
}

const showAutoDialog = ref(false)
const showEdit = ref(false)
const editThemeId = ref('')

function handleEditTheme(theme?: ThemeDef): void {
  if (theme && !theme.isCustom) return
  editThemeId.value = theme?.id ?? ''
  showEdit.value = true
}
</script>

<template>
  <div class="theme">
    <button
      v-for="item in themeItems"
      :key="item.def.id"
      class="theme-item"
      :class="{ active: themeId === item.def.id }"
      :style="item.styles"
      :aria-label="item.def.name"
      :aria-pressed="themeId === item.def.id"
      @click="toggleTheme(item.def.id)"
      @contextmenu.prevent="handleEditTheme(item.def)"
    >
      <span class="preview">
        <span class="preview-image" />
        <span class="swatch" />
        <span v-if="themeId === item.def.id" class="check">✓</span>
      </span>
      <span class="label">
        <strong>{{ item.def.name }}</strong>
        <small>{{ themeKind(item.def) }}</small>
      </span>
    </button>

    <button
      class="theme-item auto"
      :class="{ active: themeId === 'auto' }"
      :style="autoStyles"
      aria-label="跟随系统"
      :aria-pressed="themeId === 'auto'"
      @click="toggleTheme('auto')"
      @contextmenu.prevent="showAutoDialog = true"
    >
      <span class="preview auto-preview">
        <span class="light" />
        <span class="dark" />
        <span v-if="themeId === 'auto'" class="check">✓</span>
      </span>
      <span class="label">
        <strong>跟随系统</strong>
        <small>右键设置明暗主题</small>
      </span>
    </button>

    <button class="theme-item add" aria-label="添加主题" @click="handleEditTheme()">
      <span class="preview add-preview">
        <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </span>
      <span class="label">
        <strong>添加主题</strong>
        <small>创建自己的配色</small>
      </span>
    </button>
  </div>
  <AutoThemeDialog v-model="showAutoDialog" />
  <ThemeEditDialog v-model="showEdit" :theme-id="editThemeId" />
</template>

<style scoped>
.theme {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(148px, 1fr));
  gap: 10px;
}
.theme-item {
  min-width: 0;
  padding: 0;
  border: 1px solid var(--color-primary-alpha-900);
  border-radius: 10px;
  overflow: hidden;
  color: var(--color-font);
  background: color-mix(in srgb, var(--color-main-background) 94%, transparent);
  text-align: left;
  cursor: pointer;
  transition:
    border-color 0.18s ease,
    box-shadow 0.18s ease,
    transform 0.18s ease;
}
.theme-item:hover {
  border-color: var(--color-primary-alpha-600);
  box-shadow: 0 7px 18px rgba(0, 0, 0, 0.07);
  transform: translateY(-2px);
}
.theme-item.active {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 2px var(--color-primary-alpha-800);
}
.theme-item.active:hover {
  transform: none;
}
.preview {
  position: relative;
  display: block;
  height: 72px;
  overflow: hidden;
  background-color: var(--color-primary-theme);
}
.preview-image {
  position: absolute;
  inset: 0;
  background-image: var(--background-image-theme);
  background-position: center 38%;
  background-size: cover;
  background-repeat: no-repeat;
}
.preview::after {
  position: absolute;
  inset: 0;
  content: '';
  background: linear-gradient(180deg, transparent 45%, rgba(0, 0, 0, 0.12));
}
.swatch {
  position: absolute;
  z-index: 1;
  left: 9px;
  bottom: 8px;
  width: 18px;
  height: 6px;
  border-radius: 999px;
  background: var(--color-primary-theme);
  box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.85);
}
.check {
  position: absolute;
  z-index: 2;
  top: 7px;
  right: 7px;
  display: grid;
  place-items: center;
  width: 21px;
  height: 21px;
  border-radius: 50%;
  color: var(--color-primary);
  background: rgba(255, 255, 255, 0.94);
  font-size: 12px;
  font-weight: 800;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.14);
}
.label {
  display: grid;
  gap: 3px;
  min-width: 0;
  padding: 9px 10px 10px;
}
.label strong,
.label small {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.label strong {
  font-size: 11px;
  font-weight: 650;
}
.label small {
  color: var(--color-font-label);
  font-size: 9px;
}
.auto .light,
.auto .dark {
  position: absolute;
  inset: 0;
  background-position: center;
  background-size: cover;
  background-repeat: no-repeat;
}
.auto .light {
  clip-path: polygon(0 0, 100% 0, 0 100%);
  background-color: var(--color-primary-theme-light);
  background-image: var(--background-image-theme-light);
}
.auto .dark {
  clip-path: polygon(0 100%, 100% 0, 100% 100%);
  background-color: var(--color-primary-theme-dark);
  background-image: var(--background-image-theme-dark);
}
.add-preview {
  display: grid;
  place-items: center;
  color: var(--color-primary);
  background:
    radial-gradient(circle at center, var(--color-primary-alpha-800), transparent 58%),
    color-mix(in srgb, var(--color-main-background) 92%, var(--color-primary) 8%);
}
.add .icon {
  width: 25px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.5;
  stroke-linecap: round;
}

@media (prefers-reduced-motion: reduce) {
  .theme-item {
    transition: none;
  }
}
</style>
