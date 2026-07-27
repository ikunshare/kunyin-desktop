<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { PlaylistSortField, PlaylistSortOrder } from '@common'

// 「排序歌曲」弹窗（对齐 lx-music-desktop 的 ListSortModal）：
// 选字段 + 方向后应用，主进程整体重写歌单内 position。随机模式不需要字段。
const props = defineProps<{ playlistId: number; playlistName: string }>()
const emit = defineEmits<{ close: []; sorted: [] }>()

const FIELDS: { key: PlaylistSortField; label: string }[] = [
  { key: 'title', label: '按歌曲名' },
  { key: 'artist', label: '按歌手' },
  { key: 'album', label: '按专辑' },
  { key: 'duration', label: '按时长' },
  { key: 'source', label: '按来源' }
]
const ORDERS: { key: PlaylistSortOrder; label: string }[] = [
  { key: 'asc', label: '升序' },
  { key: 'desc', label: '降序' },
  { key: 'random', label: '随机' }
]

const field = ref<PlaylistSortField>('title')
const order = ref<PlaylistSortOrder>('asc')
const busy = ref(false)

async function apply(): Promise<void> {
  if (busy.value) return
  busy.value = true
  try {
    await window.api.library.sortSongs(props.playlistId, field.value, order.value)
    emit('sorted')
    emit('close')
  } finally {
    busy.value = false
  }
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') emit('close')
}
onMounted(() => document.addEventListener('keydown', onKey))
onBeforeUnmount(() => document.removeEventListener('keydown', onKey))
</script>

<template>
  <Teleport to="body">
    <div class="overlay" @click.self="emit('close')">
      <div class="card" role="dialog" aria-modal="true">
        <header class="head">
          <span class="head-title ellipsis">排序「{{ playlistName }}」的歌曲</span>
        </header>

        <div class="body">
          <div class="group-label">排序字段</div>
          <div class="opts">
            <button
              v-for="f in FIELDS"
              :key="f.key"
              class="opt"
              :class="{ on: field === f.key, dim: order === 'random' }"
              :disabled="order === 'random'"
              @click="field = f.key"
            >
              {{ f.label }}
            </button>
          </div>
          <div class="group-label">排序方式</div>
          <div class="opts">
            <button
              v-for="o in ORDERS"
              :key="o.key"
              class="opt"
              :class="{ on: order === o.key }"
              @click="order = o.key"
            >
              {{ o.label }}
            </button>
          </div>
        </div>

        <footer class="foot">
          <button class="btn ghost" @click="emit('close')">取消</button>
          <button class="btn primary" :disabled="busy" @click="apply">应用排序</button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.28);
}
.card {
  display: flex;
  flex-direction: column;
  width: 320px;
  border-radius: 8px;
  background: var(--color-main-background);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.24);
  overflow: hidden;
}
.head {
  flex: none;
  padding: 10px 14px;
  background: var(--color-primary-background-active);
}
.head-title {
  display: block;
  font-size: 13.5px;
  font-weight: 600;
  color: var(--color-font);
}
.body {
  padding: 12px 14px 4px;
}
.group-label {
  margin: 6px 0 8px;
  font-size: 12px;
  color: var(--color-font-label);
}
.opts {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 10px;
}
.opt {
  padding: 6px 12px;
  border-radius: var(--form-radius);
  font-size: 12.5px;
  color: var(--color-font);
  background: var(--color-primary-background);
  transition:
    background 0.12s ease,
    color 0.12s ease;
}
.opt:hover {
  background: var(--color-primary-background-hover);
}
.opt.on {
  color: #fff;
  background: var(--color-primary);
}
.opt.dim {
  opacity: 0.4;
  cursor: default;
}
.foot {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 10px 14px 14px;
}
.btn {
  padding: 7px 16px;
  border-radius: var(--form-radius);
  font-size: 13px;
  transition: background 0.15s ease;
}
.btn.ghost {
  color: var(--color-font);
  background: var(--color-primary-background);
}
.btn.ghost:hover {
  background: var(--color-primary-background-hover);
}
.btn.primary {
  color: #fff;
  background: var(--color-primary);
}
.btn.primary:hover {
  filter: brightness(1.06);
}
.btn.primary:disabled {
  opacity: 0.5;
}
</style>
