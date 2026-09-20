<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { SHORTCUT_ACTIONS } from '@common'
import BaseInput from '../../components/BaseInput.vue'
import BaseBtn from '../../components/BaseBtn.vue'
import { useSettingsStore } from '../../stores/settings'
const store = useSettingsStore()
const errors = ref<Record<string, string>>({})
const saving = ref(false)
onMounted(async () => {
  errors.value = await window.api.media.shortcutStatus()
})
async function save(id: string, key: string): Promise<void> {
  if (saving.value) return
  saving.value = true
  try {
    await store.update({ player: { shortcuts: { [id]: key } } })
    errors.value = await window.api.media.shortcutStatus()
  } catch (e) {
    errors.value[id] = e instanceof Error ? e.message : '保存失败'
  } finally {
    saving.value = false
  }
}
function capture(id: string, e: KeyboardEvent): void {
  if (e.key === 'Tab') return
  e.preventDefault()
  if (e.key === 'Backspace' || e.key === 'Delete') {
    void save(id, '')
    return
  }
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return
  if (!e.ctrlKey && !e.altKey && !e.metaKey && !/^F\d{1,2}$/.test(e.key)) {
    errors.value[id] = '请同时按 Ctrl、Alt 或 Command；也可使用 F1–F24'
    return
  }
  const key = e.code.startsWith('Key')
    ? e.code.slice(3)
    : e.code.startsWith('Digit')
      ? e.code.slice(5)
      : e.key.replace('Arrow', '')
  void save(
    id,
    [
      e.ctrlKey ? 'Control' : '',
      e.altKey ? 'Alt' : '',
      e.shiftKey ? 'Shift' : '',
      e.metaKey ? 'Super' : '',
      key === ' ' ? 'Space' : key
    ]
      .filter(Boolean)
      .join('+')
  )
}
</script>
<template>
  <dt id="hotkey">快捷键设置</dt>
  <dd>
    <h3>全局快捷键</h3>
    <p>点击输入框后按下组合键。清空即停用，窗口最小化时也可使用。</p>
    <div v-for="action in SHORTCUT_ACTIONS" :key="action.id" class="row">
      <label :for="'shortcut-' + action.id">{{ action.label }}</label
      ><BaseInput
        :id="'shortcut-' + action.id"
        :model-value="store.settings.player.shortcuts[action.id] || ''"
        :disabled="saving"
        :aria-describedby="errors[action.id] ? 'shortcut-error-' + action.id : undefined"
        :aria-invalid="!!errors[action.id]"
        readonly
        placeholder="点击设置"
        @keydown="capture(action.id, $event)"
      /><BaseBtn min :disabled="saving" @click="save(action.id, '')">清空</BaseBtn
      ><span v-if="errors[action.id]" :id="'shortcut-error-' + action.id" role="status">{{
        errors[action.id]
      }}</span>
    </div>
  </dd>
</template>
<style scoped>
p {
  color: var(--color-font-label);
  font-size: 12px;
  margin-bottom: 18px;
}
.row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin: 12px 0;
  font-size: 12px;
}
.row label {
  width: 140px;
}
.row input {
  width: 180px;
}
.row span {
  color: var(--color-font);
  flex-basis: 100%;
  padding-left: 150px;
}
</style>
