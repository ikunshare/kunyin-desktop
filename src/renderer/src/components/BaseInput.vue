<script setup lang="ts">
defineProps<{ modelValue: string | number; multiline?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
function update(event: Event): void {
  emit('update:modelValue', (event.target as HTMLInputElement | HTMLTextAreaElement).value)
}
</script>

<template>
  <textarea v-if="multiline" class="field" :value="modelValue" @input="update" />
  <input v-else class="field" :value="modelValue" @input="update" />
</template>

<style scoped>
.field {
  min-width: 0;
  padding: 8px 12px;
  border: 1px solid var(--color-primary-alpha-900);
  border-radius: 8px;
  background-color: color-mix(in srgb, var(--color-main-background) 88%, var(--color-primary) 12%);
  color: var(--color-font);
  caret-color: var(--color-primary-font);
  font: inherit;
  font-size: 12px;
  line-height: 1.5;
  outline: none;
  transition:
    border-color 0.2s ease,
    box-shadow 0.2s ease,
    background-color 0.2s ease;
}
.field::placeholder {
  color: var(--color-font-label);
}
.field:hover:not(:disabled) {
  border-color: var(--color-primary-alpha-700);
}
.field:focus-visible {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 3px var(--color-primary-alpha-800);
}
.field:disabled {
  opacity: 0.5;
  cursor: default;
}
textarea.field {
  resize: vertical;
}
</style>
