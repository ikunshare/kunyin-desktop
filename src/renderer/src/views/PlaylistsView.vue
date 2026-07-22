<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import AppIcon from '../components/AppIcon.vue'
import SongRow from '../components/SongRow.vue'
import ContextMenu, { type MenuItem } from '../components/ContextMenu.vue'
import { useLibraryStore } from '../stores/library'
import { usePlayerStore } from '../stores/player'
import { useDownloadStore } from '../stores/download'
import { useApi } from '../composables/useApi'
import {
  getMusicItemKey,
  type AccountStatus,
  type LocalPlaylist,
  type MusicItem,
  type MusicSource,
  type PlayListInfoResult
} from '@common'

defineOptions({ name: 'PlaylistsView' })

const library = useLibraryStore()
const player = usePlayerStore()
const download = useDownloadStore()
const api = useApi()
const { playlists } = storeToRefs(library)

// ============ 左栏：列表清单 ============
// 系统固定入口
const trial = computed(() => playlists.value.find((p) => p.systemKind === 'trial'))
const favorites = computed(() => playlists.value.find((p) => p.systemKind === 'favorites'))
// 用户自建歌单（getPlaylists 已按 sort_order 排好序，此处保持顺序）
const customPlaylists = computed(() => playlists.value.filter((p) => !p.isSystem))

// 各平台登录后的「我的歌单」
interface PlatformGroup {
  source: MusicSource
  displayName: string
  playlists: PlayListInfoResult[]
}
const platformGroups = ref<PlatformGroup[]>([])
let accountUnsub: (() => void) | null = null

async function loadPlatformPlaylists(): Promise<void> {
  const accounts: AccountStatus[] = await api.account.list()
  const loggedIn = accounts.filter((a) => a.loggedIn)
  const groups = await Promise.all(
    loggedIn.map(async (a) => {
      const source = a.provider as MusicSource
      const lists = await api.discover.userPlaylists(source).catch(() => [])
      return { source, displayName: a.displayName, playlists: lists }
    })
  )
  platformGroups.value = groups.filter((g) => g.playlists.length > 0)
}

// ============ 选中态与右栏歌曲 ============
type Selection =
  | { kind: 'local'; id: number; name: string }
  | { kind: 'platform'; source: MusicSource; id: string; name: string; cover?: string }

const selection = ref<Selection | null>(null)
const tracks = ref<MusicItem[]>([])
const loadingTracks = ref(false)
const searchText = ref('')

/** 当前选中项唯一 key，用于左栏高亮与防竞态 */
const selectedKey = computed(() => {
  const s = selection.value
  if (!s) return ''
  return s.kind === 'local' ? `local:${s.id}` : `platform:${s.source}:${s.id}`
})

const filteredTracks = computed(() => {
  const q = searchText.value.trim().toLowerCase()
  if (!q) return tracks.value
  return tracks.value.filter(
    (t) =>
      t.title.toLowerCase().includes(q) ||
      t.artist.toLowerCase().includes(q) ||
      (t.album ?? '').toLowerCase().includes(q)
  )
})

async function selectLocal(p: LocalPlaylist): Promise<void> {
  selection.value = { kind: 'local', id: p.id, name: p.name }
  searchText.value = ''
  clearSelection()
  await loadTracks()
}
async function selectPlatform(g: PlatformGroup, p: PlayListInfoResult): Promise<void> {
  selection.value = { kind: 'platform', source: g.source, id: p.id, name: p.name, cover: p.cover }
  searchText.value = ''
  clearSelection()
  await loadTracks()
}

async function loadTracks(): Promise<void> {
  const s = selection.value
  if (!s) {
    tracks.value = []
    return
  }
  loadingTracks.value = true
  const token = selectedKey.value
  try {
    let list: MusicItem[] = []
    if (s.kind === 'local') {
      list = await library.playlistSongs(s.id)
    } else {
      const res = await api.discover.playlistSongs(s.source, s.id, 0, 100)
      list = res.result
    }
    if (token === selectedKey.value) tracks.value = list // 已切列表则丢弃过期结果
  } finally {
    if (token === selectedKey.value) loadingTracks.value = false
  }
}

function isActive(item: MusicItem): boolean {
  return !!player.current && getMusicItemKey(player.current) === getMusicItemKey(item)
}
function play(item: MusicItem): void {
  // 在线歌单播放累积进试听列表；本地歌单（含试听列表自身）不动试听列表
  player.playItem(item, tracks.value, { trackTrial: selection.value?.kind === 'platform' })
}
function playAll(): void {
  if (filteredTracks.value.length) play(filteredTracks.value[0])
}

// 定位到正在播放的歌曲行（先清搜索，再滚到 .song-row.active 居中）
const trackListEl = ref<HTMLElement | null>(null)
async function locateCurrent(): Promise<void> {
  searchText.value = ''
  await nextTick()
  const el = trackListEl.value?.querySelector('.song-row.active')
  el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
}

// ============ 多选批量操作 ============
const selectedKeys = ref<Set<string>>(new Set())
const anchorIndex = ref(-1)
const selectedCount = computed(() => selectedKeys.value.size)
const selectedItems = computed(() =>
  tracks.value.filter((t) => selectedKeys.value.has(getMusicItemKey(t)))
)
function isSelected(item: MusicItem): boolean {
  return selectedKeys.value.has(getMusicItemKey(item))
}
function clearSelection(): void {
  selectedKeys.value = new Set()
  anchorIndex.value = -1
}
/** 行点击：Shift 连选、Ctrl/Cmd 加减、普通单选 */
function onRowSelect(e: MouseEvent, index: number): void {
  const list = filteredTracks.value
  if (e.shiftKey && anchorIndex.value >= 0) {
    const [a, b] = [anchorIndex.value, index].sort((x, y) => x - y)
    const next = new Set(selectedKeys.value)
    for (let i = a; i <= b; i++) next.add(getMusicItemKey(list[i]))
    selectedKeys.value = next
    return
  }
  const key = getMusicItemKey(list[index])
  if (e.ctrlKey || e.metaKey) {
    const next = new Set(selectedKeys.value)
    next.has(key) ? next.delete(key) : next.add(key)
    selectedKeys.value = next
  } else {
    selectedKeys.value = new Set([key])
  }
  anchorIndex.value = index
}

function playSelected(): void {
  const items = selectedItems.value
  if (items.length)
    player.playItem(items[0], items, { trackTrial: selection.value?.kind === 'platform' })
}
async function removeSelected(): Promise<void> {
  const s = selection.value
  if (s?.kind !== 'local') return
  for (const item of selectedItems.value) await library.removeFromPlaylist(s.id, item)
  clearSelection()
  showToast('已从列表移除')
}
function downloadSelected(): void {
  for (const item of selectedItems.value) void download.add(item)
  showToast(`已加入下载 ${selectedItems.value.length} 首`)
}

// 批量「添加到列表」选单（复用 ContextMenu）
const addMenu = ref<{ x: number; y: number } | null>(null)
const addMenuItems = computed<MenuItem[]>(() => {
  const fav = playlists.value.find((p) => p.systemKind === 'favorites')
  const items: MenuItem[] = []
  if (fav) items.push({ key: `add:${fav.id}`, label: '我的收藏', icon: 'heart' })
  for (const p of customPlaylists.value)
    items.push({ key: `add:${p.id}`, label: p.name, icon: 'library' })
  if (!items.length) items.push({ key: 'noop', label: '暂无列表', disabled: true })
  return items
})
function openAddMenu(e: MouseEvent): void {
  addMenu.value = { x: e.clientX, y: e.clientY }
}
async function onAddSelect(key: string): Promise<void> {
  addMenu.value = null
  if (!key.startsWith('add:')) return
  const pid = Number(key.slice(4))
  const items = selectedItems.value
  for (const item of items) await library.addToPlaylist(pid, item)
  showToast(`已添加 ${items.length} 首到列表`)
}

// ============ 新建歌单 ============
const creating = ref(false)
const newName = ref('')
async function confirmCreate(): Promise<void> {
  const name = newName.value.trim()
  if (!name) {
    creating.value = false
    return
  }
  const id = await library.createPlaylist(name)
  newName.value = ''
  creating.value = false
  const created = playlists.value.find((p) => p.id === id)
  if (created) void selectLocal(created)
}

// ============ 重命名（内联编辑）============
const renamingId = ref<number | null>(null)
const renameText = ref('')
const renameInput = ref<HTMLInputElement | null>(null)
async function startRename(p: LocalPlaylist): Promise<void> {
  closeMenu()
  renamingId.value = p.id
  renameText.value = p.name
  await nextTick()
  renameInput.value?.focus()
  renameInput.value?.select()
}
async function confirmRename(): Promise<void> {
  const id = renamingId.value
  if (id == null) return
  const name = renameText.value.trim()
  renamingId.value = null
  if (name) {
    await library.renamePlaylist(id, name)
    if (selection.value?.kind === 'local' && selection.value.id === id)
      selection.value = { kind: 'local', id, name }
  }
}

// ============ 删除（确认）============
const pendingDelete = ref<LocalPlaylist | null>(null)
async function confirmDelete(): Promise<void> {
  const p = pendingDelete.value
  pendingDelete.value = null
  if (!p) return
  const wasSelected = selection.value?.kind === 'local' && selection.value.id === p.id
  await library.deletePlaylist(p.id)
  if (wasSelected) {
    if (favorites.value) void selectLocal(favorites.value)
    else selection.value = null
  }
}

// ============ 右键菜单 ============
interface MenuState {
  x: number
  y: number
  playlist: LocalPlaylist
}
const menu = ref<MenuState | null>(null)
const menuItems = computed<MenuItem[]>(() => {
  const p = menu.value?.playlist
  if (!p) return []
  const items: MenuItem[] = [{ key: 'play', label: '播放', icon: 'play' }]
  if (!p.isSystem) {
    items.push({ key: 'rename', label: '重命名', icon: 'edit' })
  }
  items.push({ key: 'export', label: '导出列表', icon: 'upload', divider: true })
  if (!p.isSystem) {
    items.push({ key: 'delete', label: '删除', icon: 'trash', danger: true })
  }
  return items
})
function openMenu(e: MouseEvent, p: LocalPlaylist): void {
  menu.value = { x: e.clientX, y: e.clientY, playlist: p }
}
function closeMenu(): void {
  menu.value = null
}
async function onMenuSelect(key: string): Promise<void> {
  const p = menu.value?.playlist
  closeMenu()
  if (!p) return
  if (key === 'play') {
    await selectLocal(p)
    playAll()
  } else if (key === 'rename') {
    void startRename(p)
  } else if (key === 'delete') {
    pendingDelete.value = p
  } else if (key === 'export') {
    void exportList(p)
  }
}

// ============ 导入 / 导出 ============
const toast = ref('')
let toastTimer: ReturnType<typeof setTimeout> | null = null
function showToast(msg: string): void {
  toast.value = msg
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = ''), 3600)
}

async function importList(): Promise<void> {
  const path = await api.backup.pickOpen([{ name: 'LX 歌单', extensions: ['lxmc', 'json', 'txt'] }])
  if (!path) return
  const summary = await api.backup.lxParse(path).catch(() => null)
  if (!summary) {
    showToast('无法识别该歌单文件')
    return
  }
  const r = await api.backup.lxImport(path)
  if (!r) {
    showToast('导入失败')
    return
  }
  await library.refresh().catch(() => {})
  showToast(`导入完成：歌单 +${r.playlistsCreated}，歌曲 +${r.songsAdded}`)
}

async function exportList(p: LocalPlaylist): Promise<void> {
  const path = await api.backup.pickSave(`${p.name}.json`)
  if (!path) return
  await api.backup.exportPlaylists(path, {
    includeFavorites: p.systemKind === 'favorites',
    includeTrial: p.systemKind === 'trial',
    playlistIds: p.isSystem ? [] : [p.id]
  })
  showToast(`已导出「${p.name}」`)
}

// ============ 拖拽排序（仅自建歌单）============
const dragId = ref<number | null>(null)
const dragOverId = ref<number | null>(null)
function onDragStart(p: LocalPlaylist): void {
  dragId.value = p.id
}
function onDragOver(e: DragEvent, p: LocalPlaylist): void {
  if (dragId.value == null || dragId.value === p.id) return
  e.preventDefault()
  dragOverId.value = p.id
}
async function onDrop(target: LocalPlaylist): Promise<void> {
  const from = dragId.value
  dragId.value = null
  dragOverId.value = null
  if (from == null || from === target.id) return
  const targetIndex = customPlaylists.value.findIndex((p) => p.id === target.id)
  if (targetIndex < 0) return
  await library.movePlaylist(from, targetIndex)
}
function onDragEnd(): void {
  dragId.value = null
  dragOverId.value = null
}

// ============ 生命周期 ============
let libraryUnsub: (() => void) | null = null
onMounted(async () => {
  await library.refresh().catch(() => {})
  void loadPlatformPlaylists()
  accountUnsub = api.account.onChange(() => void loadPlatformPlaylists())
  // 曲库变更（收藏/删歌/排序）时刷新右栏；playlists 列表由 App 层全局订阅刷新
  libraryUnsub = api.library.onChange(() => {
    if (selection.value?.kind === 'local') void loadTracks()
  })
  // 默认选中「我的收藏」
  if (!selection.value && favorites.value) void selectLocal(favorites.value)
})
onUnmounted(() => {
  accountUnsub?.()
  libraryUnsub?.()
})
</script>

<template>
  <div class="mylist" @click="closeMenu">
    <!-- 左栏：列表清单 -->
    <aside class="sidebar scroll">
      <div class="side-head">
        <span class="side-title">我的列表</span>
        <div class="side-actions">
          <button class="icon-btn" title="导入歌单" @click="importList">
            <AppIcon name="download" :size="16" />
          </button>
          <button class="icon-btn" title="新建列表" @click="creating = true">
            <AppIcon name="plus" :size="16" />
          </button>
        </div>
      </div>

      <div v-if="creating" class="create-row">
        <input
          v-model="newName"
          class="inline-input"
          placeholder="输入列表名称"
          autofocus
          @keyup.enter="confirmCreate"
          @keyup.esc="creating = false"
          @blur="confirmCreate"
        />
      </div>

      <!-- 系统列表 -->
      <div class="side-group">
        <button
          v-if="trial"
          class="list-item"
          :class="{ active: selectedKey === `local:${trial.id}` }"
          @click="trial && selectLocal(trial)"
          @contextmenu.prevent.stop="trial && openMenu($event, trial)"
        >
          <span class="li-icon"><AppIcon name="clock" :size="16" /></span>
          <span class="li-name ellipsis">试听列表</span>
          <span class="li-count">{{ trial.songCount }}</span>
        </button>
        <button
          v-if="favorites"
          class="list-item"
          :class="{ active: selectedKey === `local:${favorites.id}` }"
          @click="favorites && selectLocal(favorites)"
          @contextmenu.prevent.stop="favorites && openMenu($event, favorites)"
        >
          <span class="li-icon"><AppIcon name="heart" :size="16" /></span>
          <span class="li-name ellipsis">我的收藏</span>
          <span class="li-count">{{ favorites.songCount }}</span>
        </button>
      </div>

      <!-- 自建列表 -->
      <div class="side-group">
        <div class="group-label">自建列表</div>
        <template v-for="p in customPlaylists" :key="p.id">
          <div v-if="renamingId === p.id" class="create-row">
            <input
              ref="renameInput"
              v-model="renameText"
              class="inline-input"
              @keyup.enter="confirmRename"
              @keyup.esc="renamingId = null"
              @blur="confirmRename"
            />
          </div>
          <button
            v-else
            class="list-item"
            :class="{ active: selectedKey === `local:${p.id}`, 'drop-over': dragOverId === p.id }"
            draggable="true"
            @click="selectLocal(p)"
            @contextmenu.prevent.stop="openMenu($event, p)"
            @dragstart="onDragStart(p)"
            @dragover="onDragOver($event, p)"
            @drop="onDrop(p)"
            @dragend="onDragEnd"
          >
            <span class="li-icon"><AppIcon name="library" :size="15" /></span>
            <span class="li-name ellipsis">{{ p.name }}</span>
            <span class="li-count">{{ p.songCount }}</span>
          </button>
        </template>
        <div v-if="!customPlaylists.length && !creating" class="group-empty">
          点右上角 + 新建列表
        </div>
      </div>

      <!-- 平台歌单分组 -->
      <div v-for="g in platformGroups" :key="g.source" class="side-group">
        <div class="group-label">{{ g.displayName }}</div>
        <button
          v-for="p in g.playlists"
          :key="p.id"
          class="list-item"
          :class="{ active: selectedKey === `platform:${g.source}:${p.id}` }"
          @click="selectPlatform(g, p)"
        >
          <span class="li-cover">
            <img v-if="p.cover" :src="p.cover" alt="" />
            <AppIcon v-else name="library" :size="14" />
          </span>
          <span class="li-name ellipsis">{{ p.name }}</span>
          <span class="li-count">{{ p.total ?? 0 }}</span>
        </button>
      </div>
    </aside>

    <!-- 右栏：选中列表的歌曲 -->
    <section class="detail">
      <div v-if="!selection" class="detail-empty">选择左侧列表查看歌曲</div>
      <template v-else>
        <div class="detail-toolbar">
          <button class="play-all" :disabled="!filteredTracks.length" @click="playAll">
            <AppIcon name="play" :size="15" />
            <span>播放全部</span>
          </button>
          <div class="detail-title ellipsis">{{ selection.name }}</div>
          <div class="detail-count">{{ tracks.length }} 首</div>
          <button
            v-if="player.current"
            class="tool-btn"
            title="定位当前播放"
            @click="locateCurrent"
          >
            <AppIcon name="locate" :size="15" />
          </button>
          <div class="detail-search">
            <AppIcon name="search" :size="14" />
            <input v-model="searchText" placeholder="搜索列表内歌曲" />
          </div>
        </div>

        <div v-if="loadingTracks" class="detail-hint">加载中…</div>
        <div v-else-if="!filteredTracks.length" class="detail-hint">
          {{ searchText ? '没有匹配的歌曲' : '这个列表还没有歌曲' }}
        </div>
        <div v-else ref="trackListEl" class="track-list scroll">
          <SongRow
            v-for="(t, i) in filteredTracks"
            :key="getMusicItemKey(t)"
            :item="t"
            :index="i"
            :active="isActive(t)"
            :selected="isSelected(t)"
            :removable-from="selection.kind === 'local' ? selection.id : undefined"
            @play="play(t)"
            @select="onRowSelect($event, i)"
          />
        </div>

        <!-- 批量操作栏 -->
        <Transition name="batchbar">
          <div v-if="selectedCount" class="batch-bar">
            <span class="batch-count">已选 {{ selectedCount }} 首</span>
            <button class="batch-btn" @click="playSelected">
              <AppIcon name="play" :size="14" /><span>播放</span>
            </button>
            <button class="batch-btn" @click="openAddMenu">
              <AppIcon name="plus" :size="14" /><span>添加到列表</span>
            </button>
            <button v-if="selection.kind === 'local'" class="batch-btn" @click="removeSelected">
              <AppIcon name="trash" :size="14" /><span>移除</span>
            </button>
            <button class="batch-btn" @click="downloadSelected">
              <AppIcon name="download" :size="14" /><span>下载</span>
            </button>
            <button class="batch-btn ghost" @click="clearSelection">
              <AppIcon name="close" :size="14" /><span>取消</span>
            </button>
          </div>
        </Transition>
      </template>
    </section>

    <!-- 列表项右键菜单 -->
    <ContextMenu
      v-if="menu"
      :x="menu.x"
      :y="menu.y"
      :items="menuItems"
      @select="onMenuSelect"
      @close="closeMenu"
    />

    <!-- 批量「添加到列表」选单 -->
    <ContextMenu
      v-if="addMenu"
      :x="addMenu.x"
      :y="addMenu.y"
      :items="addMenuItems"
      @select="onAddSelect"
      @close="addMenu = null"
    />

    <!-- 删除确认 -->
    <div v-if="pendingDelete" class="overlay" @click.self="pendingDelete = null">
      <div class="confirm-card">
        <div class="confirm-title">删除列表</div>
        <div class="confirm-text">确定删除「{{ pendingDelete.name }}」？此操作不可撤销。</div>
        <div class="confirm-actions">
          <button class="btn-ghost" @click="pendingDelete = null">取消</button>
          <button class="btn-danger" @click="confirmDelete">删除</button>
        </div>
      </div>
    </div>

    <!-- 轻提示 -->
    <Transition name="toast">
      <div v-if="toast" class="toast">{{ toast }}</div>
    </Transition>
  </div>
</template>

<style scoped>
.mylist {
  display: flex;
  height: 100%;
  min-height: 0;
}

/* ---------- 左栏 ---------- */
.sidebar {
  flex: none;
  width: 232px;
  height: 100%;
  padding: 12px 10px;
  border-right: 1px solid var(--color-primary-alpha-900);
}
.side-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 6px 10px;
}
.side-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}
.side-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--color-font);
}
.icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  color: var(--color-font-label);
  transition:
    color 0.2s ease,
    background 0.2s ease;
}
.icon-btn:hover {
  color: var(--color-primary);
  background: var(--color-primary-background);
}

.side-group {
  margin-bottom: 12px;
}
.group-label {
  padding: 6px 8px 4px;
  font-size: 11px;
  font-weight: 600;
  color: var(--color-font-label);
}
.group-empty {
  padding: 6px 8px;
  font-size: 12px;
  color: var(--color-font-label);
}

.list-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 38px;
  padding: 0 8px;
  border-radius: var(--radius-border);
  text-align: left;
  color: var(--color-font);
  transition:
    background 0.18s ease,
    color 0.18s ease;
}
.list-item:hover {
  background: var(--color-primary-background-hover);
}
.list-item.active {
  background: var(--color-primary-background-active);
  color: var(--color-primary-font);
}
/* LX 招牌：选中项左侧强调条 */
.list-item.active::before {
  content: '';
  position: absolute;
  left: -4px;
  top: 50%;
  transform: translateY(-50%);
  width: 3px;
  height: 16px;
  border-radius: var(--radius-progress);
  background: var(--color-primary);
}
.list-item.drop-over {
  box-shadow: inset 0 2px 0 var(--color-primary);
}
.li-icon {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  color: var(--color-font-label);
}
.list-item.active .li-icon {
  color: var(--color-primary);
}
.li-cover {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 3px;
  overflow: hidden;
  color: var(--color-font-label);
  background: var(--color-primary-background);
}
.li-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.li-name {
  flex: 1;
  min-width: 0;
  font-size: 13px;
}
.li-count {
  flex: none;
  font-size: 11px;
  color: var(--color-font-label);
}

.create-row {
  padding: 2px 4px 6px;
}
.inline-input {
  width: 100%;
  padding: 7px 9px;
  border-radius: var(--form-radius);
  font-size: 13px;
  color: var(--color-font);
  background: var(--color-primary-background);
}

/* ---------- 右栏 ---------- */
.detail {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.detail-empty,
.detail-hint {
  padding: 40px 0;
  text-align: center;
  font-size: 13px;
  color: var(--color-font-label);
}
.detail-toolbar {
  flex: none;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px 20px 12px;
}
.play-all {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 18px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 500;
  color: #fff;
  background: var(--color-primary);
  box-shadow: 0 4px 12px var(--color-primary-alpha-300);
  transition:
    background 0.2s ease,
    transform 0.1s ease;
}
.play-all:hover {
  background: var(--color-primary-dark-100);
}
.play-all:active {
  transform: scale(0.97);
}
.play-all:disabled {
  opacity: 0.5;
  cursor: default;
  box-shadow: none;
}
.detail-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--color-font);
}
.detail-count {
  flex: none;
  font-size: 12px;
  color: var(--color-font-label);
}
.tool-btn {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  color: var(--color-font-label);
  transition:
    color 0.18s ease,
    background 0.18s ease;
}
.tool-btn:hover {
  color: var(--color-primary);
  background: var(--color-primary-background);
}
.detail-search {
  flex: none;
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  padding: 6px 10px;
  border-radius: var(--form-radius);
  color: var(--color-font-label);
  background: var(--color-primary-background);
}
.detail-search input {
  width: 150px;
  font-size: 12px;
  color: var(--color-font);
}
.track-list {
  flex: 1;
  min-height: 0;
  padding: 0 16px 16px;
}

/* ---------- 批量操作栏 ---------- */
.batch-bar {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 16px 14px;
  padding: 8px 14px;
  border-radius: 10px;
  background: var(--color-content-background);
  border: 1px solid var(--color-primary-light-100-alpha-700);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
}
.batch-count {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-primary-font);
  margin-right: 4px;
}
.batch-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 12px;
  color: var(--color-font);
  transition: background 0.15s ease;
}
.batch-btn:hover {
  background: var(--color-primary-background-hover);
}
.batch-btn.ghost {
  margin-left: auto;
  color: var(--color-font-label);
}
.batchbar-enter-active,
.batchbar-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}
.batchbar-enter-from,
.batchbar-leave-to {
  opacity: 0;
  transform: translateY(8px);
}

/* ---------- 删除确认 ---------- */
.overlay {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.28);
}
.confirm-card {
  width: 320px;
  padding: 20px;
  border-radius: 8px;
  background: var(--color-main-background);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.24);
}
.confirm-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--color-font);
}
.confirm-text {
  margin-top: 10px;
  font-size: 13px;
  line-height: 1.5;
  color: var(--color-font-label);
}
.confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 20px;
}
.btn-ghost,
.btn-danger {
  padding: 7px 16px;
  border-radius: var(--form-radius);
  font-size: 13px;
  transition: background 0.15s ease;
}
.btn-ghost {
  color: var(--color-font);
  background: var(--color-primary-background);
}
.btn-ghost:hover {
  background: var(--color-primary-background-hover);
}
.btn-danger {
  color: #fff;
  background: #e5484d;
}
.btn-danger:hover {
  background: #cf3438;
}

/* ---------- 轻提示 ---------- */
.toast {
  position: fixed;
  left: 50%;
  bottom: calc(var(--height-player) + 20px);
  transform: translateX(-50%);
  z-index: 80;
  padding: 10px 18px;
  border-radius: 20px;
  font-size: 13px;
  color: #fff;
  background: rgba(40, 40, 40, 0.92);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.22);
  backdrop-filter: blur(6px);
}
.toast-enter-active,
.toast-leave-active {
  transition:
    opacity 0.25s ease,
    transform 0.25s ease;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translate(-50%, 8px);
}
</style>
