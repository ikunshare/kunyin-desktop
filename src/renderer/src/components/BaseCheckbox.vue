<script setup lang="ts">
import { computed } from 'vue'

// 移植自 lx-music-desktop（Apache-2.0, © lyswhut）components/base/Checkbox.vue。
// 支持布尔模式（modelValue: boolean）与单选模式（need + value，modelValue 为当前选中值）。
const props = withDefaults(
  defineProps<{
    modelValue: boolean | string | number
    /** 单选模式下本项代表的值 */
    value?: string | number
    id: string
    name?: string
    /** 单选（radio）行为 */
    need?: boolean
    label?: string
    disabled?: boolean
  }>(),
  { need: false, disabled: false, value: undefined, name: undefined, label: undefined }
)

const emit = defineEmits<{ (e: 'update:modelValue', v: boolean | string | number): void }>()

const checked = computed(() => {
  if (typeof props.modelValue === 'boolean') return props.modelValue
  return props.value != null && props.modelValue === props.value
})

function toggle(): void {
  if (props.disabled) return
  if (props.need) {
    if (!checked.value && props.value != null) emit('update:modelValue', props.value)
    return
  }
  if (typeof props.modelValue === 'boolean') emit('update:modelValue', !props.modelValue)
  else emit('update:modelValue', checked.value ? '' : (props.value ?? ''))
}

function onInput(e: Event): void {
  // 原生 input 行为入口（label for 触发）
  ;(e.target as HTMLInputElement).checked = checked.value
  toggle()
}
</script>

<template>
  <div class="checkbox">
    <input
      :id="id"
      class="input"
      :type="need ? 'radio' : 'checkbox'"
      :checked="checked"
      :disabled="disabled"
      :value="value"
      :name="name"
      aria-hidden="true"
      @input="onInput"
    />
    <label :for="id" class="content">
      <span
        class="container"
        :class="{ checked }"
        role="checkbox"
        tabindex="0"
        :aria-checked="checked"
        :aria-label="label"
        @keydown.enter.space.stop.prevent="toggle"
      >
        <svg class="icon" viewBox="0 0 448 512" aria-hidden="true">
          <path
            fill="currentColor"
            d="M438.6 105.4c12.5 12.5 12.5 32.8 0 45.3l-256 256c-12.5 12.5-32.8 12.5-45.3 0l-128-128c-12.5-12.5-12.5-32.8 0-45.3s32.8-12.5 45.3 0L160 338.7 393.4 105.4c12.5-12.5 32.8-12.5 45.3 0z"
          />
        </svg>
      </span>
      <slot v-if="label == null" />
      <span v-else class="label">{{ label }}</span>
    </label>
  </div>
</template>

<style scoped>
.checkbox {
  display: inline-block;
}
.input {
  display: none;
}
.input:disabled + .content {
  opacity: 0.5;
}
.input:disabled + .content .container,
.input:disabled + .content .label {
  cursor: default;
}
.input:checked + .content .container::after {
  border-color: var(--color-primary-font);
}
.input:checked + .content .icon {
  transform: scale(1);
}
.content {
  display: flex;
  align-items: center;
}
.container {
  flex: none;
  position: relative;
  width: 1em;
  height: 1em;
  cursor: pointer;
  display: flex;
  color: var(--color-primary);
}
.container::after {
  position: absolute;
  content: ' ';
  top: 0;
  bottom: 0;
  left: 0;
  right: 0;
  border: 1px solid var(--color-font-label);
  transition: border-color 0.2s ease;
  border-radius: 2px;
}
.icon {
  width: 100%;
  height: 100%;
  transition: transform 0.3s ease;
  transform: scale(0);
  border-radius: 2px;
}
.label {
  flex: auto;
  margin-left: 5px;
  line-height: 1.5;
  cursor: pointer;
}
</style>
