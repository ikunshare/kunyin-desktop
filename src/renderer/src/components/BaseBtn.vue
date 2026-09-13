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
  min-height: 34px;
  border: 1px solid var(--color-primary-alpha-900);
  border-radius: 8px;
  cursor: pointer;
  padding: 8px 15px;
  color: var(--color-button-font);
  outline: none;
  transition:
    background-color 0.2s ease,
    transform 0.2s ease,
    box-shadow 0.2s ease;
  background-color: color-mix(in srgb, var(--color-main-background) 82%, var(--color-primary) 18%);
  font-size: 12px;
}
.btn:disabled {
  opacity: 0.4;
  cursor: default;
}
.btn.outline {
  background-color: transparent;
}
.btn:hover:not(:disabled) {
  background-color: var(--color-button-background-hover);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.06);
}
.btn:active:not(:disabled) {
  background-color: var(--color-button-background-active);
}
.btn:focus-visible {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 3px var(--color-primary-alpha-800);
}
.min {
  min-height: 30px;
  padding: 4px 10px;
  font-size: 12px;
}
</style>
