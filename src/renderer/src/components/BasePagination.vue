<script setup lang="ts">
import { computed } from 'vue'
import AppIcon from './AppIcon.vue'

/**
 * 分页条（对应 LX material-pagination）：上一页 / 页码窗口 / 下一页。
 * page 为 0 基，显示为 1 基；页码窗口最多 7 格，首尾页始终可见，中间用省略号收起。
 */
const props = defineProps<{ page: number; pageCount: number; disabled?: boolean }>()
const emit = defineEmits<{ change: [page: number] }>()

const pages = computed<(number | '…')[]>(() => {
  const count = Math.max(1, props.pageCount)
  const cur = props.page
  if (count <= 7) return Array.from({ length: count }, (_, i) => i)
  const out: (number | '…')[] = [0]
  const from = Math.max(1, Math.min(cur - 2, count - 6))
  const to = Math.min(count - 2, Math.max(cur + 2, 5))
  if (from > 1) out.push('…')
  for (let i = from; i <= to; i++) out.push(i)
  if (to < count - 2) out.push('…')
  out.push(count - 1)
  return out
})

function go(p: number): void {
  if (props.disabled || p === props.page || p < 0 || p >= props.pageCount) return
  emit('change', p)
}
</script>

<template>
  <nav class="pagination" aria-label="分页">
    <button class="pg-btn" :disabled="disabled || page <= 0" title="上一页" @click="go(page - 1)">
      <AppIcon name="chevron-right" :size="12" class="flip" />
    </button>
    <template v-for="(p, i) in pages" :key="i">
      <span v-if="p === '…'" class="pg-gap">…</span>
      <button
        v-else
        class="pg-btn num"
        :class="{ active: p === page }"
        :disabled="disabled"
        @click="go(p)"
      >
        {{ p + 1 }}
      </button>
    </template>
    <button
      class="pg-btn"
      :disabled="disabled || page >= pageCount - 1"
      title="下一页"
      @click="go(page + 1)"
    >
      <AppIcon name="chevron-right" :size="12" />
    </button>
  </nav>
</template>

<style scoped>
.pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 15px 0;
  font-size: 12px;
}
.pg-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 28px;
  height: 28px;
  padding: 0 8px;
  border-radius: var(--form-radius);
  color: var(--color-button-font);
  background: var(--color-button-background);
  transition:
    background 0.15s ease,
    color 0.15s ease;
}
.pg-btn:hover:not(:disabled) {
  background: var(--color-button-background-hover);
}
.pg-btn:active:not(:disabled) {
  background: var(--color-button-background-active);
}
.pg-btn:disabled {
  opacity: 0.4;
  cursor: default;
}
.pg-btn.active {
  color: var(--color-primary);
  background: var(--color-primary-background);
  cursor: default;
}
.pg-gap {
  padding: 0 2px;
  color: var(--color-font-label);
}
.flip {
  transform: rotate(180deg);
}
</style>
