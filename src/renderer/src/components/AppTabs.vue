<script setup lang="ts">
interface TabItem {
  id: string
  label: string
}

withDefaults(
  defineProps<{
    modelValue: string
    list: TabItem[]
    align?: 'left' | 'center' | 'right'
  }>(),
  { align: 'left' }
)

const emit = defineEmits<{ 'update:modelValue': [string]; change: [string] }>()

function toggle(id: string, current: string): void {
  if (id === current) return
  emit('update:modelValue', id)
  emit('change', id)
}
</script>

<template>
  <ul class="tabs" :class="align" role="tablist">
    <li
      v-for="item in list"
      :key="item.id"
      class="tab"
      :class="{ active: modelValue === item.id }"
      role="tab"
      :aria-selected="modelValue === item.id"
      @click="toggle(item.id, modelValue)"
    >
      <span class="label">{{ item.label }}</span>
    </li>
  </ul>
</template>

<style scoped>
.tabs {
  display: flex;
  flex-flow: row nowrap;
  font-size: 12px;
  gap: 25px;
  padding: 0 15px;
}
.tabs.left {
  justify-content: flex-start;
}
.tabs.center {
  justify-content: center;
}
.tabs.right {
  justify-content: flex-end;
}
.tab {
  cursor: pointer;
  color: var(--color-font);
  transition: color var(--transition-normal);
}
.tab:hover {
  color: var(--color-primary);
}
.tab.active {
  color: var(--color-primary);
  cursor: default;
}
.label {
  display: block;
  position: relative;
  padding: 8px 0;
}
.label::after {
  content: '';
  display: block;
  position: absolute;
  left: 0;
  bottom: 0;
  width: 100%;
  height: 2px;
  border-radius: 20px;
  background-color: var(--color-primary-alpha-300);
  transform: translateY(-4px);
  opacity: 0;
  transition: var(--transition-fast);
  transition-property: transform, opacity;
}
.tab.active .label::after {
  transform: translateY(0);
  opacity: 1;
}
</style>
