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
  padding: 6px 10px;
  border-radius: var(--form-radius);
  background-color: var(--color-primary-background);
  color: var(--color-font);
  cursor: pointer;
  transition: background-color 0.2s ease;
}
.selection:hover {
  background-color: var(--color-primary-background-hover);
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
