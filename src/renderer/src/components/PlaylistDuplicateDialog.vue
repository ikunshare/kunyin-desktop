<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import AppIcon from './AppIcon.vue'
import { getMusicItemKey, PLATFORM_SHORT_TAGS, type MusicItem } from '@common'
import { useLibraryStore } from '../stores/library'
import { usePlayerStore } from '../stores/player'

// 「重复歌曲」弹窗（对齐 lx-music-desktop 的 ListDuplicateModal）：
// 按歌名归一化（去空白、小写）分组找出同名歌曲（多为不同音源的同一首），
// 列出后可试听与逐条移除。移除后即时重扫。
const props = defineProps<{ playlistId: number; playlistName: string }>()
const emit = defineEmits<{ close: [] }>()

const library = useLibraryStore()
const player = usePlayerStore()

const loading = ref(true)
const songs = ref<MusicItem[]>([])

function normTitle(t: string): string {
  return t.toLowerCase().replace(/\s+/g, '')
}

interface DupEntry {
  item: MusicItem
  /** 组内序号（同名第一首=1） */
  nth: number
  /** 组首行显示归组标题 */
  groupHead: boolean
}

const entries = computed<DupEntry[]>(() => {
  const groups = new Map<string, MusicItem[]>()
  for (const s of songs.value) {
    const k = normTitle(s.title)
    if (!k) continue
    const arr = groups.get(k)
    if (arr) arr.push(s)
    else groups.set(k, [s])
  }
  const out: DupEntry[] = []
  for (const arr of groups.values()) {
    if (arr.length < 2) continue
    arr.forEach((item, i) => out.push({ item, nth: i + 1, groupHead: i === 0 }))
  }
  return out
})

async function scan(): Promise<void> {
  loading.value = true
  try {
    songs.value = await library.playlistSongs(props.playlistId)
  } finally {
    loading.value = false
  }
}

function fmt(ms: number): string {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function play(item: MusicItem): void {
  // 队列压缩成单曲，标记为临时单曲队列（不属于任何列表，列表页不显示「正在播放」标记）
  player.playItem(item, [item], { source: { kind: 'single' } })
}

const busyKey = ref('')
async function remove(item: MusicItem): Promise<void> {
  const k = getMusicItemKey(item)
  if (busyKey.value) return
  busyKey.value = k
  try {
    await library.removeFromPlaylist(props.playlistId, item)
    songs.value = songs.value.filter((s) => getMusicItemKey(s) !== k)
  } finally {
    busyKey.value = ''
  }
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') emit('close')
}
onMounted(() => {
  document.addEventListener('keydown', onKey)
  void scan()
})
onBeforeUnmount(() => document.removeEventListener('keydown', onKey))
</script>

<template>
  <Teleport to="body">
    <div class="overlay" @click.self="emit('close')">
      <div class="card" role="dialog" aria-modal="true">
        <header class="head">
          <span class="head-title ellipsis">「{{ playlistName }}」的重复歌曲</span>
        </header>

        <div class="body scroll">
          <div v-if="loading" class="empty">正在扫描…</div>
          <div v-else-if="!entries.length" class="empty">没有发现重复歌曲</div>
          <template v-else>
            <div
              v-for="e in entries"
              :key="getMusicItemKey(e.item)"
              class="row"
              :class="{ head: e.groupHead }"
            >
              <span class="tag">{{ PLATFORM_SHORT_TAGS[e.item.type] ?? e.item.type }}</span>
              <span class="name ellipsis" :title="e.item.title">{{ e.item.title }}</span>
              <span class="artist ellipsis" :title="e.item.artist">{{ e.item.artist }}</span>
              <span class="time">{{ fmt(e.item.duration) }}</span>
              <button class="op" title="试听" @click="play(e.item)">
                <AppIcon name="play" :size="13" />
              </button>
              <button
                class="op danger"
                title="从列表移除"
                :disabled="!!busyKey"
                @click="remove(e.item)"
              >
                <AppIcon name="trash" :size="13" />
              </button>
            </div>
          </template>
        </div>

        <footer class="foot">
          <span class="foot-hint">{{ loading ? '' : `共 ${entries.length} 首同名歌曲` }}</span>
          <button class="btn ghost" @click="emit('close')">关闭</button>
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
  width: 520px;
  max-height: 70vh;
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
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 8px;
}
.empty {
  padding: 26px 0;
  text-align: center;
  font-size: 12.5px;
  color: var(--color-font-label);
}
.row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border-radius: 5px;
  font-size: 12.5px;
  color: var(--color-font);
}
/* 组首行加分隔（同名歌曲的组间视觉切分） */
.row.head:not(:first-child) {
  margin-top: 6px;
  border-top: 1px solid var(--color-primary-light-100-alpha-700);
  padding-top: 12px;
  border-radius: 0 0 5px 5px;
}
.row:hover {
  background: var(--color-primary-background);
}
.tag {
  flex: none;
  padding: 1px 5px;
  border-radius: 3px;
  font-size: 10.5px;
  color: var(--color-primary-font);
  background: var(--color-primary-background);
}
.name {
  flex: 1 1 40%;
  min-width: 0;
}
.artist {
  flex: 1 1 26%;
  min-width: 0;
  color: var(--color-font-label);
}
.time {
  flex: none;
  width: 40px;
  text-align: right;
  font-size: 11.5px;
  color: var(--color-font-label);
}
.op {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 4px;
  color: var(--color-font-label);
  transition:
    color 0.12s ease,
    background 0.12s ease;
}
.op:hover {
  color: var(--color-primary);
  background: var(--color-button-background-hover);
}
.op.danger:hover {
  color: #e5484d;
  background: rgba(229, 72, 77, 0.1);
}
.foot {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-top: 1px solid var(--color-primary-light-100-alpha-700);
}
.foot-hint {
  font-size: 12px;
  color: var(--color-font-label);
}
.btn {
  padding: 7px 16px;
  border-radius: var(--form-radius);
  font-size: 13px;
}
.btn.ghost {
  color: var(--color-font);
  background: var(--color-primary-background);
}
.btn.ghost:hover {
  background: var(--color-primary-background-hover);
}
</style>
