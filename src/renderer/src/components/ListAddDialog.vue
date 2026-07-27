<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import AppIcon from './AppIcon.vue'
import type { MusicItem } from '@common'
import { useLibraryStore } from '../stores/library'

// 「添加到列表」弹窗，交互对齐 lx-music-desktop 的 ListAddModal / ListAddMultipleModal：
// 居中弹窗列出可选列表（我的收藏 + 自建歌单），点击即添加并关闭；底部可直接新建列表。
const props = defineProps<{
  /** 要添加的歌曲（单曲或多选批量） */
  items: MusicItem[]
}>()
const emit = defineEmits<{ close: []; added: [playlistName: string] }>()

const library = useLibraryStore()

const title = computed(() =>
  props.items.length === 1
    ? `添加《${props.items[0].title}》到…`
    : `添加 ${props.items.length} 首歌曲到…`
)

const lists = computed(() => {
  const fav = library.playlists.find((p) => p.systemKind === 'favorites')
  const custom = library.playlists.filter((p) => !p.isSystem)
  return [...(fav ? [fav] : []), ...custom]
})

const busy = ref(false)
async function addTo(playlistId: number, playlistName: string): Promise<void> {
  if (busy.value) return
  busy.value = true
  try {
    for (const item of props.items) await library.addToPlaylist(playlistId, item)
    emit('added', playlistName)
    emit('close')
  } finally {
    busy.value = false
  }
}

// ---- 新建列表（LX：底部虚线按钮 → 内联输入，回车创建并添加）----
const creating = ref(false)
const newName = ref('')
const nameInput = ref<HTMLInputElement | null>(null)
async function startCreate(): Promise<void> {
  creating.value = true
  await nextTick()
  nameInput.value?.focus()
}
async function confirmCreate(): Promise<void> {
  const name = newName.value.trim()
  if (!name) {
    creating.value = false
    return
  }
  const id = await library.createPlaylist(name)
  newName.value = ''
  creating.value = false
  await addTo(id, name)
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
      <div class="card" role="dialog" aria-modal="true" :aria-label="title">
        <header class="head">
          <span class="head-title ellipsis">{{ title }}</span>
        </header>

        <div class="body scroll">
          <button
            v-for="p in lists"
            :key="p.id"
            class="row"
            :disabled="busy"
            @click="addTo(p.id, p.name)"
          >
            <AppIcon
              :name="p.systemKind === 'favorites' ? 'heart' : 'library'"
              :size="15"
              class="row-ico"
            />
            <span class="row-name ellipsis">{{
              p.systemKind === 'favorites' ? '我的收藏' : p.name
            }}</span>
            <span class="row-count">{{ p.songCount }} 首</span>
          </button>
          <div v-if="!lists.length" class="empty">暂无列表，先新建一个吧</div>
        </div>

        <footer class="foot">
          <button v-if="!creating" class="new-btn" @click="startCreate">
            <AppIcon name="plus" :size="14" />
            <span>新建列表</span>
          </button>
          <div v-else class="new-input">
            <input
              ref="nameInput"
              v-model="newName"
              placeholder="列表名称，回车创建"
              maxlength="40"
              @keyup.enter="confirmCreate"
              @keyup.esc.stop="creating = false"
              @blur="confirmCreate"
            />
          </div>
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
  width: 300px;
  max-height: 66vh;
  border-radius: 8px;
  background: var(--color-main-background);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.24);
  overflow: hidden;
}
/* LX modal header：主色底白字 */
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
.row {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 9px 10px;
  border-radius: 5px;
  text-align: left;
  font-size: 13px;
  color: var(--color-font);
  transition: background 0.12s ease;
}
.row:hover {
  background: var(--color-primary-background);
}
.row:active {
  background: var(--color-primary-background-active);
}
.row:disabled {
  opacity: 0.5;
  cursor: default;
}
.row-ico {
  flex: none;
  color: var(--color-primary);
  opacity: 0.8;
}
.row-name {
  flex: 1;
  min-width: 0;
}
.row-count {
  flex: none;
  font-size: 11px;
  color: var(--color-font-label);
}
.empty {
  padding: 18px 0;
  text-align: center;
  font-size: 12.5px;
  color: var(--color-font-label);
}
.foot {
  flex: none;
  padding: 8px;
  border-top: 1px solid var(--color-primary-light-100-alpha-700);
}
.new-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  padding: 8px 0;
  border: 1px dashed var(--color-primary-alpha-600);
  border-radius: 5px;
  font-size: 12.5px;
  color: var(--color-primary-font);
  transition: background 0.12s ease;
}
.new-btn:hover {
  background: var(--color-primary-background);
}
.new-input input {
  width: 100%;
  padding: 8px 10px;
  border-radius: 5px;
  font-size: 12.5px;
  background: var(--color-primary-light-400-alpha-700);
  color: var(--color-font);
}
</style>
