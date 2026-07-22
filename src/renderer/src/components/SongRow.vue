<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import AppIcon from './AppIcon.vue'
import ContextMenu, { type MenuItem } from './ContextMenu.vue'
import type { MusicItem } from '@common'
import { useDownloadStore } from '../stores/download'
import { useLibraryStore } from '../stores/library'
import { usePlayerStore } from '../stores/player'
import { useMvStore } from '../stores/mv'

const props = defineProps<{
  item: MusicItem
  index: number
  active?: boolean
  /** 多选选中态（由父组件管理） */
  selected?: boolean
  /** 当前所在本地歌单 id；设置后右键菜单出现「从此列表移除」 */
  removableFrom?: number
}>()
const emit = defineEmits<{ play: []; select: [e: MouseEvent] }>()

const router = useRouter()
const download = useDownloadStore()
const library = useLibraryStore()
const player = usePlayerStore()
const mv = useMvStore()

function onMv(): void {
  mv.open(props.item)
}
function fmt(ms: number): string {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
function onDownload(): void {
  void download.add(props.item)
}
function onFavorite(): void {
  void library.toggleFavorite(props.item)
}

// ============ 右键菜单 ============
const menu = ref<{ x: number; y: number } | null>(null)
const menuItems = ref<MenuItem[]>([])

function buildMenu(): MenuItem[] {
  const it = props.item
  const fav = library.isFavorite(it)
  // 「添加到列表」子菜单：我的收藏 + 全部自建列表
  const favList = library.playlists.find((p) => p.systemKind === 'favorites')
  const custom = library.playlists.filter((p) => !p.isSystem)
  const addChildren: MenuItem[] = []
  if (favList) addChildren.push({ key: `add:${favList.id}`, label: '我的收藏', icon: 'heart' })
  for (const p of custom) addChildren.push({ key: `add:${p.id}`, label: p.name, icon: 'library' })
  if (!addChildren.length) addChildren.push({ key: 'noop', label: '暂无列表', disabled: true })

  const items: MenuItem[] = [
    { key: 'play', label: '播放', icon: 'play' },
    { key: 'playNext', label: '下一首播放', icon: 'skip-forward' },
    { key: 'add', label: '添加到列表', icon: 'plus', children: addChildren }
  ]
  if (props.removableFrom != null)
    items.push({ key: 'remove', label: '从此列表移除', icon: 'trash', divider: true })
  const nav: MenuItem[] = []
  if (it.albumId) nav.push({ key: 'album', label: '查看专辑', icon: 'library' })
  if (it.singers?.length) nav.push({ key: 'artist', label: '查看歌手', icon: 'search' })
  if (it.mvid) nav.push({ key: 'mv', label: '观看 MV', icon: 'video' })
  if (nav.length) {
    nav[0].divider = true
    items.push(...nav)
  }
  items.push({ key: 'download', label: '下载', icon: 'download', divider: true })
  items.push({ key: 'fav', label: fav ? '取消收藏' : '收藏', icon: fav ? 'heart-filled' : 'heart' })
  items.push({ key: 'copy', label: '复制歌曲信息', icon: 'edit', divider: true })
  return items
}

function openMenu(e: MouseEvent): void {
  menuItems.value = buildMenu()
  menu.value = { x: e.clientX, y: e.clientY }
}

function onSelect(key: string): void {
  const it = props.item
  if (key.startsWith('add:')) {
    void library.addToPlaylist(Number(key.slice(4)), it)
    return
  }
  switch (key) {
    case 'play':
      emit('play')
      break
    case 'playNext':
      player.playNext(it)
      break
    case 'remove':
      if (props.removableFrom != null) void library.removeFromPlaylist(props.removableFrom, it)
      break
    case 'album':
      if (it.albumId)
        void router.push({
          name: 'album',
          params: { albumKey: it.albumId },
          query: { source: it.type }
        })
      break
    case 'artist': {
      const sid = it.singers?.[0]?.singerId
      if (sid != null)
        void router.push({
          name: 'artist',
          params: { artistKey: String(sid) },
          query: { source: it.type }
        })
      break
    }
    case 'mv':
      onMv()
      break
    case 'download':
      onDownload()
      break
    case 'fav':
      onFavorite()
      break
    case 'copy':
      void navigator.clipboard?.writeText(`${it.title} - ${it.artist}`).catch(() => {})
      break
  }
}
</script>

<template>
  <div
    class="song-row"
    :class="{ active, selected }"
    @click="emit('select', $event)"
    @dblclick="emit('play')"
    @contextmenu.prevent.stop="openMenu($event)"
  >
    <div class="idx">
      <span class="num">{{ index + 1 }}</span>
      <button class="play" title="播放" @click.stop="emit('play')">
        <AppIcon name="play" :size="14" />
      </button>
    </div>
    <img class="cover" :src="item.cover" alt="" />
    <div class="meta">
      <div class="title ellipsis">{{ item.title }}</div>
      <div class="artist ellipsis">{{ item.artist }}</div>
    </div>
    <div class="album ellipsis">{{ item.album }}</div>
    <div class="row-ops">
      <button v-if="item.mvid" class="row-op" title="观看 MV" @click.stop="onMv">
        <AppIcon name="video" :size="15" />
      </button>
      <button
        class="row-op"
        :class="{ liked: library.isFavorite(item) }"
        title="收藏"
        @click.stop="onFavorite"
      >
        <AppIcon :name="library.isFavorite(item) ? 'heart-filled' : 'heart'" :size="15" />
      </button>
      <button class="row-op" title="下载" @click.stop="onDownload">
        <AppIcon name="download" :size="15" />
      </button>
    </div>
    <div class="dur">{{ fmt(item.duration) }}</div>

    <ContextMenu
      v-if="menu"
      :x="menu.x"
      :y="menu.y"
      :items="menuItems"
      @select="onSelect"
      @close="menu = null"
    />
  </div>
</template>

<style scoped>
.song-row {
  display: flex;
  align-items: center;
  height: 52px;
  padding: 0 8px;
  border-radius: var(--radius-border);
  font-size: 13px;
  color: var(--color-font);
  transition: background-color 0.2s ease;
}
.song-row:hover {
  background-color: var(--color-primary-background-hover);
}
.song-row.active {
  background-color: var(--color-primary-background-active);
}
.song-row.selected {
  background-color: var(--color-primary-light-100-alpha-600);
  box-shadow: inset 2px 0 0 var(--color-primary);
}

.idx {
  position: relative;
  flex: none;
  width: 28px;
  text-align: center;
  color: var(--color-font-label);
  font-size: 12px;
}
.idx .play {
  position: absolute;
  inset: 0;
  display: none;
  align-items: center;
  justify-content: center;
  color: var(--color-primary);
}
.song-row:hover .num {
  visibility: hidden;
}
.song-row:hover .play {
  display: flex;
}

.cover {
  flex: none;
  width: 40px;
  height: 40px;
  margin: 0 12px;
  border-radius: var(--radius-border);
  object-fit: cover;
}
.meta {
  flex: 1;
  min-width: 0;
}
.title {
  font-size: 13px;
  color: var(--color-font);
}
.song-row.active .title {
  color: var(--color-primary-font);
}
.artist {
  font-size: 12px;
  color: var(--color-font-label);
}
.album {
  flex: 1;
  min-width: 0;
  padding: 0 12px;
  font-size: 12px;
  color: var(--color-font-label);
}
.row-ops {
  flex: none;
  display: flex;
  align-items: center;
  gap: 4px;
  margin-right: 6px;
  opacity: 0;
  transition: opacity 0.15s ease;
}
.song-row:hover .row-ops {
  opacity: 1;
}
.row-op {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  color: var(--color-font-label);
  transition:
    color 0.15s ease,
    background 0.15s ease;
}
.row-op:hover {
  color: var(--color-primary);
  background: var(--color-primary-background);
}
.row-op.liked {
  color: var(--color-primary);
  opacity: 1;
}
/* 已收藏时即使未 hover 也显示心形 */
.song-row .row-ops:has(.liked) {
  opacity: 1;
}
.dur {
  flex: none;
  width: 44px;
  text-align: right;
  font-size: 12px;
  color: var(--color-font-label);
}
</style>
