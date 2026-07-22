<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import AppIcon from './AppIcon.vue'

/** 右键菜单项（对齐 LX Music 的列表/歌曲菜单交互）。 */
export interface MenuItem {
  key: string
  label: string
  icon?: string
  danger?: boolean
  disabled?: boolean
  /** 该项之前插入一条分隔线 */
  divider?: boolean
  /** 二级子菜单（悬停展开），如「添加到列表」 */
  children?: MenuItem[]
}

const props = defineProps<{ x: number; y: number; items: MenuItem[] }>()
const emit = defineEmits<{ select: [key: string]; close: [] }>()

const root = ref<HTMLElement | null>(null)
// 悬停展开的子菜单 key 与其纵向偏移
const openKey = ref<string | null>(null)
const subTop = ref(0)

function onItem(item: MenuItem, e: MouseEvent): void {
  if (item.disabled) return
  if (item.children?.length) {
    const li = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const box = root.value?.getBoundingClientRect()
    subTop.value = li.top - (box?.top ?? 0)
    openKey.value = item.key
    return
  }
  emit('select', item.key)
  emit('close')
}
function onChild(child: MenuItem): void {
  if (child.disabled) return
  emit('select', child.key)
  emit('close')
}

// 视口内钳制，避免菜单溢出右/下边界
const pos = ref({ left: props.x, top: props.y })
function clamp(): void {
  const el = root.value
  if (!el) return
  const { innerWidth: w, innerHeight: h } = window
  const r = el.getBoundingClientRect()
  let left = props.x
  let top = props.y
  if (left + r.width > w - 6) left = w - r.width - 6
  if (top + r.height > h - 6) top = h - r.height - 6
  pos.value = { left: Math.max(6, left), top: Math.max(6, top) }
}

function onDocDown(e: MouseEvent): void {
  if (!root.value?.contains(e.target as Node)) emit('close')
}
function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') emit('close')
}

onMounted(() => {
  clamp()
  document.addEventListener('mousedown', onDocDown, true)
  document.addEventListener('contextmenu', onDocDown, true)
  document.addEventListener('keydown', onKey)
  window.addEventListener('resize', () => emit('close'))
})
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocDown, true)
  document.removeEventListener('contextmenu', onDocDown, true)
  document.removeEventListener('keydown', onKey)
})
</script>

<template>
  <Teleport to="body">
    <div
      ref="root"
      class="ctx-menu"
      :style="{ left: pos.left + 'px', top: pos.top + 'px' }"
      @contextmenu.prevent.stop
    >
      <template v-for="item in items" :key="item.key">
        <div v-if="item.divider" class="ctx-divider" />
        <div
          class="ctx-row"
          :class="{ danger: item.danger, disabled: item.disabled, open: openKey === item.key }"
          @mouseenter="item.children?.length && onItem(item, $event)"
          @click.stop="onItem(item, $event)"
        >
          <AppIcon v-if="item.icon" :name="item.icon" :size="15" class="ctx-ico" />
          <span class="ctx-label">{{ item.label }}</span>
          <AppIcon v-if="item.children?.length" name="chevron-down" :size="14" class="ctx-arrow" />
        </div>
      </template>

      <!-- 二级子菜单 -->
      <div
        v-if="openKey"
        class="ctx-menu ctx-sub"
        :style="{ top: subTop + 'px' }"
        @mouseleave="openKey = null"
      >
        <template
          v-for="child in items.find((i) => i.key === openKey)?.children ?? []"
          :key="child.key"
        >
          <div v-if="child.divider" class="ctx-divider" />
          <div
            class="ctx-row"
            :class="{ danger: child.danger, disabled: child.disabled }"
            @click.stop="onChild(child)"
          >
            <AppIcon v-if="child.icon" :name="child.icon" :size="15" class="ctx-ico" />
            <span class="ctx-label">{{ child.label }}</span>
          </div>
        </template>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.ctx-menu {
  position: fixed;
  z-index: 200;
  min-width: 156px;
  padding: 5px;
  border-radius: 8px;
  background: var(--color-content-background);
  border: 1px solid var(--color-primary-light-100-alpha-700);
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.16);
  backdrop-filter: blur(12px) saturate(1.1);
}
.ctx-sub {
  position: absolute;
  left: calc(100% - 4px);
  min-width: 150px;
}
.ctx-row {
  display: flex;
  align-items: center;
  gap: 9px;
  height: 34px;
  padding: 0 10px;
  border-radius: 5px;
  font-size: 13px;
  color: var(--color-font);
  cursor: pointer;
  transition: background 0.12s ease;
}
.ctx-row:hover,
.ctx-row.open {
  background: var(--color-primary-background-active);
}
.ctx-row.danger {
  color: #e5484d;
}
.ctx-row.danger:hover {
  background: rgba(229, 72, 77, 0.12);
}
.ctx-row.disabled {
  opacity: 0.4;
  cursor: default;
}
.ctx-row.disabled:hover {
  background: transparent;
}
.ctx-ico {
  flex: none;
  color: var(--color-font-label);
}
.ctx-row:hover .ctx-ico,
.ctx-row.danger .ctx-ico {
  color: inherit;
}
.ctx-label {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
}
.ctx-arrow {
  flex: none;
  color: var(--color-font-label);
  transform: rotate(-90deg);
}
.ctx-divider {
  height: 1px;
  margin: 4px 8px;
  background: var(--color-primary-light-100-alpha-700);
}
</style>
