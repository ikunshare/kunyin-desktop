<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useSettingsStore } from '../../../stores/settings'
import type { CustomThemeConfig } from '@common'
import BaseBtn from '../../../components/BaseBtn.vue'
import BaseCheckbox from '../../../components/BaseCheckbox.vue'

// 自定义主题编辑器（lx-music-desktop ThemeEditModal 的简化版：
// 名称 + 主色 + 字色 + 深浅模式 + 背景图，色阶与语义色由主题引擎派生）。
const props = defineProps<{ modelValue: boolean; themeId: string }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: boolean): void }>()

const store = useSettingsStore()
const { settings } = storeToRefs(store)

const name = ref('')
const primaryHex = ref('#4daf7c')
const fontHex = ref('#212121')
const isDark = ref(false)
const bgImage = ref('')

const isEdit = computed(() => !!props.themeId)

function hexToRgbStr(hex: string): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`
}
function rgbStrToHex(rgb: string): string {
  const m = /rgba?\(\s*(\d+(?:\.\d+)?)[,\s]+(\d+(?:\.\d+)?)[,\s]+(\d+(?:\.\d+)?)/.exec(rgb)
  if (!m) return '#4daf7c'
  const to = (v: string): string => Math.round(Number(v)).toString(16).padStart(2, '0')
  return `#${to(m[1])}${to(m[2])}${to(m[3])}`
}

// 打开时初始化（新建给默认值，编辑载入现有配置）
watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    const existing = settings.value.appearance.customThemes.find((t) => t.id === props.themeId)
    name.value = existing?.name ?? ''
    primaryHex.value = existing ? rgbStrToHex(existing.primary) : '#4daf7c'
    fontHex.value = existing ? rgbStrToHex(existing.font) : '#212121'
    isDark.value = existing?.isDark ?? false
    bgImage.value = existing?.bgImage ?? ''
  }
)

async function pickBgImage(): Promise<void> {
  const path = await window.api.backup.pickOpen([
    { name: '图片', extensions: ['jpg', 'jpeg', 'png', 'webp'] }
  ])
  if (path) bgImage.value = path
}

async function save(): Promise<void> {
  const themeName = name.value.trim()
  if (!themeName) return
  const customs = [...settings.value.appearance.customThemes]
  if (!isEdit.value && customs.length >= 10) return
  const config: CustomThemeConfig = {
    id: props.themeId || `custom_${Date.now().toString(36)}`,
    name: themeName,
    isDark: isDark.value,
    primary: hexToRgbStr(primaryHex.value),
    font: hexToRgbStr(fontHex.value),
    bgImage: bgImage.value
  }
  const idx = customs.findIndex((t) => t.id === config.id)
  if (idx >= 0) customs.splice(idx, 1, config)
  else customs.push(config)
  await store.update({ appearance: { customThemes: customs } })
  emit('update:modelValue', false)
}

async function remove(): Promise<void> {
  const customs = settings.value.appearance.customThemes.filter((t) => t.id !== props.themeId)
  // 若正在使用被删主题，回落到内置默认
  const patch: Parameters<typeof store.update>[0] = { appearance: { customThemes: customs } }
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
    <div class="dialog">
      <div class="head">
        <span class="title">{{ isEdit ? '编辑主题' : '新建主题' }}</span>
        <button class="close" @click="emit('update:modelValue', false)">✕</button>
      </div>
      <div class="body">
        <label class="field">
          <span>主题名称</span>
          <input v-model="name" type="text" maxlength="10" placeholder="最多 10 个字符" />
        </label>
        <div class="colors">
          <label class="color-field">
            <span>主色</span>
            <input v-model="primaryHex" type="color" />
          </label>
          <label class="color-field">
            <span>文字颜色</span>
            <input v-model="fontHex" type="color" />
          </label>
        </div>
        <BaseCheckbox id="theme-edit-dark" v-model="isDark" label="深色模式" />
        <div class="field">
          <span>背景图（可选）</span>
          <div class="bg-row">
            <BaseBtn min @click="pickBgImage">{{ bgImage ? '重新选择' : '选择图片' }}</BaseBtn>
            <BaseBtn v-if="bgImage" min @click="bgImage = ''">清除</BaseBtn>
          </div>
          <span v-if="bgImage" class="bg-path" :title="bgImage">{{ bgImage }}</span>
        </div>
      </div>
      <div class="foot">
        <BaseBtn v-if="isEdit" class="danger" @click="remove">删除</BaseBtn>
        <div class="foot-right">
          <BaseBtn @click="emit('update:modelValue', false)">取消</BaseBtn>
          <BaseBtn class="primary" :disabled="!name.trim()" @click="save">保存</BaseBtn>
        </div>
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
  width: 360px;
  border-radius: 14px;
  background: var(--color-content-background);
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.25);
  overflow: hidden;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px 0;
}
.title {
  font-size: 15px;
  font-weight: 600;
  color: var(--color-font);
}
.close {
  color: var(--color-font-label);
  font-size: 14px;
}
.body {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  color: var(--color-font-label);
}
.field input[type='text'] {
  padding: 7px 10px;
  border-radius: var(--form-radius);
  font-size: 13px;
  color: var(--color-font);
  background: var(--color-primary-background);
}
.colors {
  display: flex;
  gap: 20px;
}
.color-field {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--color-font-label);
}
.color-field input[type='color'] {
  width: 48px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: var(--form-radius);
  background: none;
  cursor: pointer;
}
.bg-row {
  display: flex;
  gap: 8px;
}
.bg-path {
  font-size: 11px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px 16px;
}
.foot-right {
  display: flex;
  gap: 8px;
  margin-left: auto;
}
.primary {
  color: #fff;
  background: var(--color-primary);
}
.primary:hover {
  filter: brightness(1.05);
}
.danger {
  color: #fff;
  background: #d64541;
}
.danger:hover {
  filter: brightness(1.05);
}
</style>
