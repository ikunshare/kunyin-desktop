<script setup lang="ts">
// 轻量下拉选择（原生 select 主题化包装；LX 的 Selection 为自定义弹层，此处用原生控件保持简单可靠）。
defineProps<{
  modelValue: string | number
  /** 选项列表 */
  list: { id: string | number; label: string }[]
  disabled?: boolean
}>()
const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>()

function onChange(e: Event): void {
  emit('update:modelValue', (e.target as HTMLSelectElement).value)
}
</script>

<template>
  <select class="selection" :value="modelValue" :disabled="disabled" @change="onChange">
    <option v-for="item in list" :key="item.id" :value="item.id">{{ item.label }}</option>
  </select>
</template>

<style scoped>
.selection {
  min-width: 180px;
  height: 36px;
  padding: 0 34px 0 12px;
  border: 1px solid var(--color-primary-alpha-900);
  border-radius: 8px;
  background-color: color-mix(in srgb, var(--color-main-background) 88%, var(--color-primary) 12%);
  color: var(--color-font);
  font-size: 12px;
  cursor: pointer;
  outline: none;
  transition:
    border-color 0.2s ease,
    box-shadow 0.2s ease,
    background-color 0.2s ease;
}
.selection:hover {
  background-color: var(--color-primary-background-hover);
  border-color: var(--color-primary-alpha-700);
}
.selection:focus-visible {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 3px var(--color-primary-alpha-800);
}
.selection:disabled {
  opacity: 0.5;
  cursor: default;
}
.selection option {
  background-color: var(--color-main-background);
  color: var(--color-font);
}
</style>
