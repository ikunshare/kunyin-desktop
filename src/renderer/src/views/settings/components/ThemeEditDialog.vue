<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useSettingsStore } from '../../../stores/settings'
import type { CustomThemeConfig } from '@common'
import BaseCheckbox from '../../../components/BaseCheckbox.vue'

const props = defineProps<{ modelValue: boolean; themeId: string }>()
const emit = defineEmits<{ (e: 'update:modelValue', value: boolean): void }>()

const store = useSettingsStore()
const { settings } = storeToRefs(store)

const DEFAULTS = {
  name: '',
  primary: '#4daf7c',
  font: '#212121',
  appBackground: '#edf7f2',
  sidebarButton: '#4daf7c',
  contentBackground: '#ffffff',
  badgePrimary: '#4daf7c',
  badgeSecondary: '#4baed5',
  badgeTertiary: '#e7aa36',
  buttonClose: '#fab4a0',
  buttonMin: '#85c43b',
  buttonHide: '#3bc2b2',
  bgImage: '',
  isDark: false,
  isDarkFont: false,
  preview: false
}

const form = reactive({ ...DEFAULTS })
const isEdit = computed(() => !!props.themeId)

type ColorKey =
  | 'primary'
  | 'font'
  | 'appBackground'
  | 'sidebarButton'
  | 'contentBackground'
  | 'badgePrimary'
  | 'badgeSecondary'
  | 'badgeTertiary'
  | 'buttonClose'
  | 'buttonMin'
  | 'buttonHide'

const baseColors: { key: ColorKey; label: string }[] = [
  { key: 'primary', label: '主题色' },
  { key: 'font', label: '字体颜色' },
  { key: 'appBackground', label: '应用背景颜色' },
  { key: 'sidebarButton', label: '侧栏按钮颜色' },
  { key: 'contentBackground', label: '内容区域背景颜色' }
]

const badgeColors: { key: ColorKey; label: string }[] = [
  { key: 'badgePrimary', label: '主颜色' },
  { key: 'badgeSecondary', label: '次要颜色' },
  { key: 'badgeTertiary', label: '第三颜色' }
]

const windowColors: { key: ColorKey; label: string }[] = [
  { key: 'buttonClose', label: '关闭' },
  { key: 'buttonMin', label: '最小化' },
  { key: 'buttonHide', label: '隐藏播放器详情页' }
]

function hexToRgbStr(hex: string): string {
  const value = parseInt(hex.slice(1), 16)
  return `rgb(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255})`
}

function rgbStrToHex(rgb: string | undefined, fallback: string): string {
  if (!rgb) return fallback
  if (/^#[\da-f]{6}$/i.test(rgb)) return rgb
  const match = /rgba?\(\s*(\d+(?:\.\d+)?)[,\s]+(\d+(?:\.\d+)?)[,\s]+(\d+(?:\.\d+)?)/.exec(rgb)
  if (!match) return fallback
  const toHex = (value: string): string => Math.round(Number(value)).toString(16).padStart(2, '0')
  return `#${toHex(match[1])}${toHex(match[2])}${toHex(match[3])}`
}

function resetForm(existing?: CustomThemeConfig): void {
  Object.assign(form, DEFAULTS, {
    name: existing?.name ?? '',
    primary: rgbStrToHex(existing?.primary, DEFAULTS.primary),
    font: rgbStrToHex(existing?.font, DEFAULTS.font),
    appBackground: rgbStrToHex(existing?.appBackground, DEFAULTS.appBackground),
    sidebarButton: rgbStrToHex(existing?.sidebarButton, DEFAULTS.sidebarButton),
    contentBackground: rgbStrToHex(existing?.contentBackground, DEFAULTS.contentBackground),
    badgePrimary: rgbStrToHex(existing?.badgePrimary, DEFAULTS.badgePrimary),
    badgeSecondary: rgbStrToHex(existing?.badgeSecondary, DEFAULTS.badgeSecondary),
    badgeTertiary: rgbStrToHex(existing?.badgeTertiary, DEFAULTS.badgeTertiary),
    buttonClose: rgbStrToHex(existing?.buttonClose, DEFAULTS.buttonClose),
    buttonMin: rgbStrToHex(existing?.buttonMin, DEFAULTS.buttonMin),
    buttonHide: rgbStrToHex(existing?.buttonHide, DEFAULTS.buttonHide),
    bgImage: existing?.bgImage ?? '',
    isDark: existing?.isDark ?? false,
    isDarkFont: existing?.isDarkFont ?? false,
    preview: false
  })
}

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    resetForm(settings.value.appearance.customThemes.find((theme) => theme.id === props.themeId))
  }
)

const backgroundUrl = computed(() =>
  form.bgImage ? `url("file:///${encodeURI(form.bgImage.replaceAll('\\', '/'))}")` : 'none'
)

const dialogStyle = computed(() => {
  const colors = {
    '--badge-primary-preview': form.badgePrimary,
    '--badge-secondary-preview': form.badgeSecondary,
    '--badge-tertiary-preview': form.badgeTertiary,
    '--button-close-preview': form.buttonClose,
    '--button-min-preview': form.buttonMin,
    '--button-hide-preview': form.buttonHide
  }
  if (!form.preview) return colors
  return {
    ...colors,
    '--dialog-primary': form.primary,
    '--dialog-font': form.font,
    '--dialog-content': form.contentBackground,
    '--dialog-app-background': form.appBackground
  }
})

function setColor(key: ColorKey, event: Event): void {
  form[key] = (event.target as HTMLInputElement).value
}

async function pickBgImage(): Promise<void> {
  const path = await window.api.backup.pickOpen([
    { name: '图片', extensions: ['jpg', 'jpeg', 'png', 'webp'] }
  ])
  if (path) form.bgImage = path
}

async function save(): Promise<void> {
  const themeName = form.name.trim()
  if (!themeName) return
  const customThemes = [...settings.value.appearance.customThemes]
  if (!isEdit.value && customThemes.length >= 10) return
  const config: CustomThemeConfig = {
    id: props.themeId || `custom_${Date.now().toString(36)}`,
    name: themeName,
    isDark: form.isDark,
    isDarkFont: form.isDarkFont,
    primary: hexToRgbStr(form.primary),
    font: hexToRgbStr(form.font),
    bgImage: form.bgImage,
    appBackground: hexToRgbStr(form.appBackground),
    sidebarButton: hexToRgbStr(form.sidebarButton),
    contentBackground: hexToRgbStr(form.contentBackground),
    badgePrimary: hexToRgbStr(form.badgePrimary),
    badgeSecondary: hexToRgbStr(form.badgeSecondary),
    badgeTertiary: hexToRgbStr(form.badgeTertiary),
    buttonClose: hexToRgbStr(form.buttonClose),
    buttonMin: hexToRgbStr(form.buttonMin),
    buttonHide: hexToRgbStr(form.buttonHide)
  }
  const index = customThemes.findIndex((theme) => theme.id === config.id)
  if (index >= 0) customThemes.splice(index, 1, config)
  else customThemes.push(config)
  await store.update({ appearance: { customThemes } })
  emit('update:modelValue', false)
}

async function remove(): Promise<void> {
  const customThemes = settings.value.appearance.customThemes.filter(
    (theme) => theme.id !== props.themeId
  )
  const patch: Parameters<typeof store.update>[0] = { appearance: { customThemes } }
  const { themeId, lightThemeId, darkThemeId } = settings.value.appearance
  if (themeId === props.themeId) patch.appearance!.themeId = 'green'
  if (lightThemeId === props.themeId) patch.appearance!.lightThemeId = 'green'
  if (darkThemeId === props.themeId) patch.appearance!.darkThemeId = 'black'
  await store.update(patch)
  emit('update:modelValue', false)
}
</script>

<template>
  <div v-if="modelValue" class="mask" @click.self="emit('update:modelValue', false)">
    <section class="dialog" :class="{ previewing: form.preview }" :style="dialogStyle">
      <header class="toolbar">
        <button class="close" title="关闭" @click="emit('update:modelValue', false)">×</button>
      </header>

      <div class="body">
        <h2>{{ isEdit ? '编辑主题' : '添加主题' }}</h2>

        <div class="color-grid base-grid">
          <label v-for="item in baseColors" :key="item.key" class="color-item">
            <span class="color-box" :style="{ backgroundColor: form[item.key] }">
              <input
                type="color"
                :value="form[item.key]"
                :aria-label="item.label"
                @input="setColor(item.key, $event)"
              />
            </span>
            <span>{{ item.label }}</span>
          </label>
        </div>

        <div class="background-field">
          <button
            class="background-box"
            :class="{ selected: form.bgImage }"
            :style="{ backgroundImage: backgroundUrl }"
            @click="pickBgImage"
          >
            <span v-if="!form.bgImage" class="plus">＋</span>
            <span v-else class="replace">更换</span>
          </button>
          <span>背景图片</span>
          <button v-if="form.bgImage" class="clear-bg" @click="form.bgImage = ''">清除</button>
        </div>

        <div class="section-title">
          <span>标签颜色</span>
          <small class="tag-demo sq">SQ</small>
          <small class="tag-demo hq">HQ</small>
          <small class="tag-demo kw">kw</small>
        </div>
        <div class="color-grid compact-grid">
          <label v-for="item in badgeColors" :key="item.key" class="color-item">
            <span class="color-box compact" :style="{ backgroundColor: form[item.key] }">
              <input
                type="color"
                :value="form[item.key]"
                :aria-label="item.label"
                @input="setColor(item.key, $event)"
              />
            </span>
            <span>{{ item.label }}</span>
          </label>
        </div>

        <div class="section-title window-title">
          <span>左侧控制按钮颜色</span>
          <i class="dot close-dot" />
          <i class="dot min-dot" />
          <i class="dot hide-dot" />
        </div>
        <div class="color-grid compact-grid">
          <label v-for="item in windowColors" :key="item.key" class="color-item">
            <span class="color-box compact" :style="{ backgroundColor: form[item.key] }">
              <input
                type="color"
                :value="form[item.key]"
                :aria-label="item.label"
                @input="setColor(item.key, $event)"
              />
            </span>
            <span>{{ item.label }}</span>
          </label>
        </div>
      </div>

      <footer class="foot">
        <button v-if="isEdit" class="delete" @click="remove">删除</button>
        <input v-model="form.name" class="name-input" maxlength="10" placeholder="主题名称" />
        <div class="options">
          <BaseCheckbox id="theme-edit-dark" v-model="form.isDark" label="暗色主题" />
          <BaseCheckbox id="theme-edit-dark-font" v-model="form.isDarkFont" label="深色字体" />
          <BaseCheckbox id="theme-edit-preview" v-model="form.preview" label="预览主题" />
        </div>
        <button class="save" :disabled="!form.name.trim()" @click="save">保存</button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.mask {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: grid;
  place-items: center;
  padding: 18px;
  background: rgba(18, 14, 22, 0.4);
  backdrop-filter: blur(2px);
}
.dialog {
  --dialog-primary: var(--color-primary);
  --dialog-font: var(--color-font);
  --dialog-content: var(--color-main-background);
  --dialog-app-background: var(--color-app-background);
  width: min(620px, calc(100vw - 48px));
  max-height: min(520px, calc(100vh - 48px));
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: 7px;
  color: var(--dialog-font);
  background: var(--dialog-content);
  box-shadow: 0 24px 70px rgba(0, 0, 0, 0.28);
}
.toolbar {
  display: flex;
  justify-content: flex-end;
  height: 22px;
  background: var(--dialog-primary);
}
.close {
  width: 30px;
  color: color-mix(in srgb, var(--dialog-font) 72%, transparent);
  font-size: 18px;
  line-height: 20px;
}
.close:hover {
  color: var(--dialog-font);
  background: rgba(255, 255, 255, 0.18);
}
.body {
  min-height: 0;
  padding: 14px 20px 14px;
  overflow-y: auto;
}
h2 {
  margin-bottom: 18px;
  text-align: center;
  font-size: 18px;
  font-weight: 500;
}
.color-grid {
  display: grid;
  gap: 14px;
}
.base-grid {
  grid-template-columns: repeat(5, minmax(74px, 1fr));
}
.compact-grid {
  grid-template-columns: repeat(3, 100px);
  gap: 14px;
}
.color-item {
  display: grid;
  justify-items: center;
  gap: 7px;
  min-width: 0;
  color: var(--dialog-font);
  font-size: 12px;
  line-height: 1.3;
  text-align: center;
}
.color-box {
  position: relative;
  display: block;
  width: 68px;
  height: 68px;
  border: 1px solid rgba(90, 80, 96, 0.18);
  border-radius: 5px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.16);
  cursor: pointer;
  transition:
    transform 0.16s ease,
    box-shadow 0.16s ease;
}
.color-box:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 14px rgba(0, 0, 0, 0.14);
}
.color-box.compact {
  width: 58px;
  height: 58px;
}
.color-box input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
}
.background-field {
  display: grid;
  justify-items: center;
  width: 154px;
  gap: 7px;
  margin-top: 14px;
  font-size: 12px;
}
.background-box {
  position: relative;
  width: 154px;
  height: 58px;
  border: 1px dashed color-mix(in srgb, var(--dialog-font) 48%, transparent);
  border-radius: 5px;
  color: color-mix(in srgb, var(--dialog-font) 55%, transparent);
  background-position: center;
  background-size: cover;
}
.background-box.selected {
  border-style: solid;
}
.plus {
  font-size: 30px;
  font-weight: 300;
}
.replace {
  position: absolute;
  right: 6px;
  bottom: 6px;
  padding: 3px 6px;
  border-radius: 4px;
  color: white;
  background: rgba(0, 0, 0, 0.52);
  font-size: 10px;
}
.clear-bg {
  color: var(--dialog-primary);
  font-size: 10px;
}
.section-title {
  display: flex;
  align-items: center;
  gap: 9px;
  margin: 18px 0 10px;
  font-size: 13px;
}
.tag-demo {
  font-size: 9px;
  font-weight: 500;
}
.tag-demo.sq {
  color: var(--badge-primary-preview);
}
.tag-demo.hq {
  color: var(--badge-secondary-preview);
}
.tag-demo.kw {
  color: var(--badge-tertiary-preview);
}
.window-title {
  margin-top: 18px;
}
.dot {
  width: 15px;
  height: 15px;
  border-radius: 50%;
}
.close-dot {
  background: var(--button-close-preview);
}
.min-dot {
  background: var(--button-min-preview);
}
.hide-dot {
  background: var(--button-hide-preview);
}
.foot {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  border-top: 1px solid color-mix(in srgb, var(--dialog-font) 10%, transparent);
  background: color-mix(in srgb, var(--dialog-app-background) 50%, var(--dialog-content));
}
.name-input {
  width: 170px;
  height: 32px;
  padding: 0 10px;
  border-radius: 5px;
  outline: none;
  color: var(--dialog-font);
  background: color-mix(in srgb, var(--dialog-font) 9%, var(--dialog-content));
}
.name-input:focus {
  box-shadow: inset 0 0 0 1px var(--dialog-primary);
}
.options {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-left: auto;
  white-space: nowrap;
}
.save,
.delete {
  min-width: 70px;
  height: 32px;
  border-radius: 5px;
  font-size: 12px;
}
.save {
  color: color-mix(in srgb, var(--dialog-font) 72%, transparent);
  background: color-mix(in srgb, var(--dialog-font) 9%, var(--dialog-content));
}
.save:not(:disabled):hover {
  color: white;
  background: var(--dialog-primary);
}
.save:disabled {
  opacity: 0.45;
}
.delete {
  color: #d64541;
  background: rgba(214, 69, 65, 0.1);
}

@media (max-width: 680px) {
  .base-grid {
    grid-template-columns: repeat(3, 1fr);
  }
  .foot {
    flex-wrap: wrap;
  }
  .options {
    order: 3;
    width: 100%;
    margin-left: 0;
  }
}
</style>
