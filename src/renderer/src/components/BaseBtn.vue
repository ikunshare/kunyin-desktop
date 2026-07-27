<script setup lang="ts">
// 移植自 lx-music-desktop（Apache-2.0, © lyswhut）components/base/Btn.vue。
withDefaults(defineProps<{ min?: boolean; outline?: boolean; disabled?: boolean }>(), {
  min: false,
  outline: false,
  disabled: false
})
</script>

<template>
  <button class="btn" :class="{ min, outline }" tabindex="0" :disabled="disabled">
    <slot />
  </button>
</template>

<style scoped>
.btn {
  display: inline-block;
  border: none;
  border-radius: var(--form-radius);
  cursor: pointer;
  padding: 8px 15px;
  color: var(--color-button-font);
  outline: none;
  transition: background-color 0.2s ease;
  background-color: var(--color-button-background);
  font-size: 14px;
}
.btn:disabled {
  opacity: 0.4;
  cursor: default;
}
.btn.outline {
  background-color: transparent;
}
.btn:hover {
  background-color: var(--color-button-background-hover);
}
.btn:active {
  background-color: var(--color-button-background-active);
}
.min {
  padding: 3px 8px;
  font-size: 12px;
}
</style>
