<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import AppIcon from './AppIcon.vue'
import ContextMenu, { type MenuItem } from './ContextMenu.vue'
import ListAddDialog from './ListAddDialog.vue'
import QualityDialog from './QualityDialog.vue'
import RedirectDialog from './RedirectDialog.vue'
import { PLATFORM_SHORT_TAGS, getSingerRouteId, type MusicItem, type Singer } from '@common'
import { useLibraryStore } from '../stores/library'
import { usePlayerStore } from '../stores/player'
import { useMvStore } from '../stores/mv'
import { useSettingsStore } from '../stores/settings'

const props = defineProps<{
  item: MusicItem
  index: number
  /** 正在播放 */
  active?: boolean
  /** 多选选中态（由父组件管理） */
  selected?: boolean
  /** 当前所在本地歌单 id；设置后右键菜单出现「从此列表移除」 */
  removableFrom?: number
}>()
const emit = defineEmits<{ play: []; select: [e: MouseEvent] }>()

const router = useRouter()
const library = useLibraryStore()
const player = usePlayerStore()
const mv = useMvStore()
const settingsStore = useSettingsStore()

const sourceTag = PLATFORM_SHORT_TAGS[props.item.type] ?? props.item.type

function fmt(ms: number): string {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
function onMv(): void {
  mv.open(props.item)
}
// 下载前弹音质选择（对应 Android 下载对话框）
const qualityDialog = ref(false)
function onDownload(): void {
  qualityDialog.value = true
}
function onFavorite(): void {
  void library.toggleFavorite(props.item)
}

// ============ 「添加到列表」弹窗（LX ListAddModal；右键与行内 + 按钮共用） ============
const addDialog = ref(false)
// 歌词重定向弹窗
const redirectDialog = ref(false)

// 右键完整菜单
const menu = ref<{ x: number; y: number } | null>(null)
const menuItems = ref<MenuItem[]>([])

/** 能跳歌手页的歌手（接口未给 id 的会被过滤掉） */
function routableSingers(it: MusicItem): Singer[] {
  return (it.singers ?? []).filter((s) => getSingerRouteId(s, it.type))
}

/**
 * 专辑页要用的 id：QQ 的专辑接口只认 albumMid，而 albumId 在 album.id 非 0 时是数字 id，
 * 直接拿去查会空；其余源用 albumId。
 */
function albumRouteId(it: MusicItem): string | undefined {
  if (it.type === 'qq') return it.albumMid || undefined
  return it.albumId || undefined
}

function buildMenu(): MenuItem[] {
  const it = props.item
  const fav = library.isFavorite(it)
  const items: MenuItem[] = [
    { key: 'play', label: '播放', icon: 'play' },
    { key: 'playNext', label: '下一首播放', icon: 'skip-forward' },
    { key: 'add', label: '添加到列表…', icon: 'add-to' }
  ]
  if (props.removableFrom != null)
    items.push({ key: 'remove', label: '从此列表移除', icon: 'trash', divider: true })
  const nav: MenuItem[] = []
  if (albumRouteId(it)) nav.push({ key: 'album', label: '查看专辑', icon: 'library' })
  // 歌手 id 缺失（部分源接口不给）时不放入口，避免点进空白页；多歌手展开子菜单逐个选
  const routable = routableSingers(it)
  if (routable.length === 1) {
    nav.push({ key: 'artist:0', label: '查看歌手', icon: 'search' })
  } else if (routable.length > 1) {
    nav.push({
      key: 'artist',
      label: '查看歌手',
      icon: 'search',
      children: routable.map((s, i) => ({ key: `artist:${i}`, label: s.name }))
    })
  }
  if (it.mvid) nav.push({ key: 'mv', label: '观看 MV', icon: 'video' })
  if (nav.length) {
    nav[0].divider = true
    items.push(...nav)
  }
  // 本地歌曲本身就是文件，无下载语义
  if (it.type !== 'local') {
    items.push({ key: 'download', label: '下载', icon: 'download', divider: true })
  }
  items.push({ key: 'fav', label: fav ? '取消收藏' : '收藏', icon: fav ? 'heart-filled' : 'heart' })
  // 歌词搜错时手动指定目标（安卓「重定向歌曲」；本地歌曲歌词走 .lrc 边车，不适用）
  if (it.type !== 'local') {
    items.push({ key: 'redirect', label: '歌词重定向', icon: 'lyric', divider: true })
  }
  items.push({ key: 'copy', label: '复制歌曲信息', icon: 'edit', divider: true })
  return items
}

function openMenu(e: MouseEvent): void {
  menuItems.value = buildMenu()
  menu.value = { x: e.clientX, y: e.clientY }
}

function onSelect(key: string): void {
  const it = props.item
  // 「查看歌手」按 artist:<singers 下标> 回传（多歌手子菜单共用一条分支）
  if (key.startsWith('artist:')) {
    const list = routableSingers(it)
    const picked = list[Number(key.slice(7))] ?? list[0]
    const sid = picked && getSingerRouteId(picked, it.type)
    if (sid) {
      void router.push({
        name: 'artist',
        params: { artistKey: sid },
        query: { source: it.type }
      })
    }
    return
  }
  switch (key) {
    case 'play':
      emit('play')
      break
    case 'playNext':
      player.playNext(it)
      break
    case 'add':
      addDialog.value = true
      break
    case 'remove':
      if (props.removableFrom != null) void library.removeFromPlaylist(props.removableFrom, it)
      break
    case 'album': {
      const aid = albumRouteId(it)
      if (aid)
        void router.push({
          name: 'album',
          params: { albumKey: aid },
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
    case 'redirect':
      redirectDialog.value = true
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
    <div class="cell num">
      <AppIcon v-if="active" name="play" :size="14" class="play-mark" />
      <span v-else class="idx">{{ index + 1 }}</span>
    </div>
    <div class="cell name">
      <span class="song-title ellipsis">{{ item.title }}</span>
      <span class="source-tag">{{ sourceTag }}</span>
    </div>
    <div class="cell singer ellipsis">{{ item.artist }}</div>
    <div class="cell album ellipsis">{{ item.album }}</div>
    <div class="cell time">{{ fmt(item.duration) }}</div>
    <!-- 操作列格子始终保留（与列头对齐），设置关闭时仅隐藏按钮（LX 显示列表操作按钮） -->
    <div class="cell ops">
      <template v-if="settingsStore.settings.list.showOperationButtons">
        <button class="op" title="试听" @click.stop="emit('play')">
          <AppIcon name="headphone" :size="16" />
        </button>
        <button class="op" title="添加到列表" @click.stop="addDialog = true">
          <AppIcon name="add-to" :size="16" />
        </button>
        <button class="op" title="下载" @click.stop="onDownload">
          <AppIcon name="download" :size="16" />
        </button>
      </template>
    </div>

    <ContextMenu
      v-if="menu"
      :x="menu.x"
      :y="menu.y"
      :items="menuItems"
      @select="onSelect"
      @close="menu = null"
    />
    <ListAddDialog v-if="addDialog" :items="[item]" @close="addDialog = false" />
    <QualityDialog v-if="qualityDialog" :items="[item]" @close="qualityDialog = false" />
    <RedirectDialog v-if="redirectDialog" :item="item" @close="redirectDialog = false" />
  </div>
</template>

<style scoped>
.song-row {
  display: flex;
  align-items: center;
  height: 37px;
  font-size: 12.5px;
  color: var(--color-font);
  transition: background-color 0.2s ease;
}
.song-row:hover {
  background-color: var(--color-primary-background-hover);
}
.song-row.selected {
  background-color: var(--color-primary-light-100-alpha-600);
}
.song-row.active {
  color: var(--color-primary);
}

.cell {
  padding: 0 8px;
  min-width: 0;
}
.cell.num {
  flex: 0 0 5%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-font-label);
  font-size: 11px;
}
.song-row.active .cell.num {
  color: var(--color-primary);
}
.play-mark {
  opacity: 0.85;
}
.cell.name {
  flex: 1 1 auto;
  display: flex;
  align-items: center;
  gap: 6px;
}
.song-title {
  min-width: 0;
}
.source-tag {
  flex: none;
  font-size: 11px;
  line-height: 1.2;
  color: var(--color-primary);
  opacity: 0.7;
}
.cell.singer {
  flex: 0 0 22%;
}
.cell.album {
  flex: 0 0 22%;
  color: var(--color-font-label);
}
.cell.time {
  flex: 0 0 9%;
  color: var(--color-font-label);
  font-size: 12px;
}
.cell.ops {
  flex: 0 0 16%;
  display: flex;
  align-items: center;
  gap: 2px;
  padding-left: 0;
  padding-right: 0;
}
.op {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 5px 7px;
  border-radius: var(--form-radius);
  color: var(--color-button-font);
  transition: background-color 0.2s ease;
}
.op:hover {
  background-color: var(--color-button-background-hover);
}
.op:active {
  background-color: var(--color-button-background-active);
}
</style>
