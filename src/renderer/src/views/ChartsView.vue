<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import AppIcon from '../components/AppIcon.vue'
import BaseSelect from '../components/BaseSelect.vue'
import BasePagination from '../components/BasePagination.vue'
import SongRow from '../components/SongRow.vue'
import ContextMenu, { type MenuItem } from '../components/ContextMenu.vue'
import ListAddDialog from '../components/ListAddDialog.vue'
import QualityDialog from '../components/QualityDialog.vue'
import { usePlayerStore, type QueueSource } from '../stores/player'
import { useLibraryStore } from '../stores/library'
import { useSettingsStore } from '../stores/settings'
import { useApi } from '../composables/useApi'
import {
  DISCOVER_SOURCES,
  PLATFORM_NAMES,
  getMusicItemKey,
  type ChartInfo,
  type MusicItem,
  type MusicSource
} from '@common'

/**
 * 排行榜（布局与交互对齐 LX views/Leaderboard）：
 * 左栏 = 平台下拉 + 榜单列表（右键：播放 / 收藏）；右栏 = 歌曲表格 + 分页。
 * 双击行播放（队列 = 当前页），榜单「播放」先播首页、后台补齐余页进队列。
 */
defineOptions({ name: 'ChartsView' })

const api = useApi()
const player = usePlayerStore()
const library = useLibraryStore()
const showListOps = computed(() => useSettingsStore().settings.list.showOperationButtons)

const PAGE_SIZE = 100
const MAX_PAGES = 30
const SAVE_KEY = 'kunyin:charts:selection'

const sourceOptions = DISCOVER_SOURCES.map((id) => ({ id, label: PLATFORM_NAMES[id] }))

// ============ 平台 / 榜单 ============
const source = ref<MusicSource>('wy')
const boardId = ref('')
const boards = ref<ChartInfo[]>([])
const boardsLoading = ref(false)
const boardsError = ref('')
const boardCache = new Map<MusicSource, ChartInfo[]>()

const board = computed(() => boards.value.find((b) => b.id === boardId.value))

function restore(): void {
  try {
    const saved = JSON.parse(localStorage.getItem(SAVE_KEY) ?? 'null') as {
      source?: MusicSource
      boardId?: string
    } | null
    if (saved?.source && DISCOVER_SOURCES.includes(saved.source)) {
      source.value = saved.source
      boardId.value = saved.boardId ?? ''
    }
  } catch {
    /* ignore */
  }
}
function persist(): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({ source: source.value, boardId: boardId.value }))
  } catch {
    /* ignore */
  }
}

let boardsToken = 0
async function loadBoards(): Promise<void> {
  const token = ++boardsToken
  const src = source.value
  boardsError.value = ''
  let list = boardCache.get(src)
  if (!list) {
    boardsLoading.value = true
    boards.value = []
    try {
      list = await api.discover.charts(src)
      boardCache.set(src, list)
    } catch (e) {
      if (token === boardsToken) boardsError.value = e instanceof Error ? e.message : '加载失败'
      return
    } finally {
      if (token === boardsToken) boardsLoading.value = false
    }
  }
  if (token !== boardsToken) return
  boards.value = list
  // 记忆的榜单不在列表里（或首次进入）则回落到第一个（LX 默认选中首榜）
  if (!list.some((b) => b.id === boardId.value)) boardId.value = list[0]?.id ?? ''
  persist()
}

function switchSource(id: string): void {
  if (id === source.value) return
  source.value = id as MusicSource
  boardId.value = ''
  clearSelection()
}
function selectBoard(id: string): void {
  if (id === boardId.value) return
  boardId.value = id
  clearSelection()
  persist()
}

// ============ 右栏歌曲 ============
const tracks = ref<MusicItem[]>([])
const page = ref(0)
const total = ref(0)
const hasNext = ref(false)
const loading = ref(false)
const error = ref('')
const trackListEl = ref<HTMLElement | null>(null)

const pageCount = computed(() => {
  if (total.value > 0) return Math.max(1, Math.ceil(total.value / PAGE_SIZE))
  return hasNext.value ? page.value + 2 : page.value + 1
})
const showPagination = computed(
  () => !loading.value && tracks.value.length > 0 && pageCount.value > 1
)

async function fetchPage(b: ChartInfo, p: number): ReturnType<typeof api.discover.chartSongs> {
  return api.discover.chartSongs(b.source, b.id, p, PAGE_SIZE, b.period ?? '')
}

let loadToken = 0
async function loadTracks(p = 0): Promise<void> {
  const b = board.value
  const token = ++loadToken
  if (!b) {
    tracks.value = []
    total.value = 0
    hasNext.value = false
    return
  }
  loading.value = true
  error.value = ''
  try {
    const result = await fetchPage(b, p)
    if (token !== loadToken) return
    tracks.value = result.result
    page.value = p
    total.value = result.total ?? 0
    hasNext.value = result.hasNext && result.result.length > 0
    await nextTick()
    trackListEl.value?.scrollTo({ top: 0 })
  } catch (e) {
    if (token === loadToken) {
      error.value = e instanceof Error ? e.message : '榜单加载失败，请重试'
      tracks.value = []
    }
  } finally {
    if (token === loadToken) loading.value = false
  }
}

function togglePage(p: number): void {
  clearSelection()
  void loadTracks(p)
}

// ============ 播放 ============
function queueSourceFor(b: ChartInfo): QueueSource {
  return { kind: 'platform', id: `${b.source}:chart:${b.id}`, name: b.name }
}
const playingBoardId = computed(() => {
  const s = player.queueSource
  if (s?.kind !== 'platform' || !s.id) return ''
  const prefix = `${source.value}:chart:`
  return s.id.startsWith(prefix) ? s.id.slice(prefix.length) : ''
})
function isActive(item: MusicItem): boolean {
  return !!player.current && getMusicItemKey(player.current) === getMusicItemKey(item)
}
function play(item: MusicItem): void {
  const b = board.value
  if (!b) return
  player.playItem(item, tracks.value, { source: queueSourceFor(b) })
}

/** 榜单「播放」：先播首页，再在后台把余下页补进队列（LX playSongListDetail） */
async function playBoard(b: ChartInfo): Promise<void> {
  const src = queueSourceFor(b)
  try {
    let first: MusicItem[]
    let more: boolean
    if (b.id === boardId.value && tracks.value.length && page.value === 0) {
      first = tracks.value
      more = hasNext.value
    } else {
      const result = await fetchPage(b, 0)
      first = result.result
      more = result.hasNext && first.length > 0
    }
    if (!first.length) {
      showToast('这个榜单暂时没有可播放的歌曲')
      return
    }
    player.playItem(first[0], first, { source: src })
    for (let p = 1; more && p < MAX_PAGES; p++) {
      const result = await fetchPage(b, p)
      if (!player.appendToQueue(result.result, src)) return // 队列已被切走
      more = result.hasNext && result.result.length > 0
    }
  } catch (e) {
    showToast(e instanceof Error ? e.message : '播放失败，请重试')
  }
}

// ============ 收藏为本地歌单 ============
const collecting = ref(new Set<string>())
async function collectBoard(b: ChartInfo): Promise<void> {
  const key = `${b.source}:${b.id}`
  if (collecting.value.has(key)) return
  collecting.value.add(key)
  try {
    await api.library.importRemote(b.source, b.id, b.name, true, b.period ?? '')
    await library.refresh()
    showToast(`已收藏「${b.name}」到我的歌单`)
  } catch (e) {
    showToast(e instanceof Error ? e.message : '收藏失败，请重试')
  } finally {
    collecting.value.delete(key)
  }
}

// ============ 榜单右键菜单 ============
const menu = ref<{ x: number; y: number; board: ChartInfo } | null>(null)
const menuItems = computed<MenuItem[]>(() => [
  { key: 'play', label: '播放', icon: 'play' },
  {
    key: 'collect',
    label: '收藏到我的歌单',
    icon: 'heart',
    disabled:
      !!menu.value && collecting.value.has(`${menu.value.board.source}:${menu.value.board.id}`)
  }
])
function openMenu(e: MouseEvent, b: ChartInfo): void {
  menu.value = { x: e.clientX, y: e.clientY, board: b }
}
function closeMenu(): void {
  menu.value = null
}
function onMenuSelect(key: string): void {
  const b = menu.value?.board
  closeMenu()
  if (!b) return
  if (key === 'play') void playBoard(b)
  else if (key === 'collect') void collectBoard(b)
}

// ============ 多选批量操作（与「我的列表」一致） ============
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
function onRowSelect(e: MouseEvent, index: number): void {
  const list = tracks.value
  if (e.shiftKey) {
    if (selectedKeys.value.size && anchorIndex.value >= 0) {
      if (anchorIndex.value !== index) {
        const [a, b] = [anchorIndex.value, index].sort((x, y) => x - y)
        const next = new Set<string>()
        for (let i = a; i <= b; i++) next.add(getMusicItemKey(list[i]))
        selectedKeys.value = next
      }
    } else {
      selectedKeys.value = new Set([getMusicItemKey(list[index])])
      anchorIndex.value = index
    }
  } else if (e.ctrlKey || e.metaKey) {
    anchorIndex.value = index
    const key = getMusicItemKey(list[index])
    const next = new Set(selectedKeys.value)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    selectedKeys.value = next
  } else if (selectedKeys.value.size) {
    clearSelection()
  }
}
function playSelected(): void {
  const items = selectedItems.value
  const b = board.value
  if (items.length && b) player.playItem(items[0], items, { source: queueSourceFor(b) })
}
const addDialog = ref(false)
const qualityDialog = ref(false)
function onAdded(): void {
  showToast(`已添加 ${selectedItems.value.length} 首到列表`)
  clearSelection()
}
function onDownloadAdded(): void {
  showToast(`已加入下载 ${selectedItems.value.length} 首`)
  clearSelection()
}

async function locateCurrent(): Promise<void> {
  await nextTick()
  trackListEl.value
    ?.querySelector('.song-row.active')
    ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
}

// ============ 轻提示 ============
const toast = ref('')
let toastTimer: ReturnType<typeof setTimeout> | null = null
function showToast(msg: string): void {
  toast.value = msg
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = ''), 3600)
}

// ============ 生命周期 ============
// 先恢复记忆的平台/榜单，再由 immediate watch 触发首轮加载（避免 mounted 里改 source 造成重复请求）
restore()
watch(source, () => void loadBoards(), { immediate: true })
// 以榜单对象为监听源：切平台时先变 undefined 再变新榜单，缓存命中也能正确触发
watch(board, () => void loadTracks(0))
</script>

<template>
  <div class="charts" @click="closeMenu">
    <!-- 左栏：平台 + 榜单列表 -->
    <aside class="sidebar">
      <div class="side-head">
        <BaseSelect
          class="src-select"
          :model-value="source"
          :list="sourceOptions"
          title="切换平台"
          @update:model-value="switchSource"
        />
      </div>
      <div class="side-lists scroll">
        <div v-if="boardsLoading" class="side-hint">加载中…</div>
        <div v-else-if="boardsError" class="side-hint">
          {{ boardsError }}
          <button class="link-btn" @click="loadBoards">重试</button>
        </div>
        <button
          v-for="b in boards"
          :key="b.id"
          class="list-item"
          :class="{ active: b.id === boardId }"
          :title="b.updateFrequency ? `${b.name} · ${b.updateFrequency}` : b.name"
          @click="selectBoard(b.id)"
          @contextmenu.prevent.stop="openMenu($event, b)"
        >
          <AppIcon v-if="b.id === boardId" name="chevron-right" :size="12" class="li-mark" />
          <span class="li-name ellipsis">{{ b.name }}</span>
          <AppIcon
            v-if="playingBoardId === b.id"
            name="headphone"
            :size="13"
            class="li-playing"
            title="正在播放此榜单"
          />
        </button>
      </div>
    </aside>

    <!-- 右栏：歌曲表格 -->
    <section class="detail">
      <div class="track-head">
        <div class="th num"></div>
        <div class="th name">歌曲名</div>
        <div class="th singer">艺术家</div>
        <div class="th album">专辑名</div>
        <div class="th time">时长</div>
        <div class="th ops">
          <span>{{ showListOps ? '操作' : '' }}</span>
          <span class="head-tools">
            <button
              v-if="board"
              class="head-tool"
              :title="`播放整个「${board.name}」`"
              @click="playBoard(board)"
            >
              <AppIcon name="play" :size="14" />
            </button>
            <button
              v-if="board"
              class="head-tool"
              :disabled="collecting.has(`${board.source}:${board.id}`)"
              title="收藏到我的歌单"
              @click="collectBoard(board)"
            >
              <AppIcon name="heart" :size="14" />
            </button>
            <button
              v-if="player.current"
              class="head-tool"
              title="定位当前播放"
              @click="locateCurrent"
            >
              <AppIcon name="locate" :size="14" />
            </button>
          </span>
        </div>
      </div>

      <div v-if="error" class="detail-hint" role="alert">
        {{ error }}
        <button class="link-btn" @click="loadTracks(page)">重试</button>
      </div>
      <div v-else-if="loading" class="detail-hint">加载中…</div>
      <div v-else-if="!tracks.length" class="detail-hint">
        {{ board ? '这个榜单暂时没有歌曲' : '选择左侧榜单查看歌曲' }}
      </div>
      <div v-else ref="trackListEl" class="track-list scroll">
        <SongRow
          v-for="(t, i) in tracks"
          :key="getMusicItemKey(t)"
          :item="t"
          :index="page * PAGE_SIZE + i"
          :active="isActive(t)"
          :selected="isSelected(t)"
          @play="play(t)"
          @select="onRowSelect($event, i)"
        />
        <BasePagination
          v-if="showPagination"
          :page="page"
          :page-count="pageCount"
          :disabled="loading"
          @change="togglePage"
        />
      </div>

      <Transition name="batchbar">
        <div v-if="selectedCount" class="batch-bar">
          <span class="batch-count">已选 {{ selectedCount }} 首</span>
          <button class="batch-btn" @click="playSelected">
            <AppIcon name="play" :size="14" /><span>播放</span>
          </button>
          <button class="batch-btn" @click="addDialog = true">
            <AppIcon name="plus" :size="14" /><span>添加到列表</span>
          </button>
          <button class="batch-btn" @click="qualityDialog = true">
            <AppIcon name="download" :size="14" /><span>下载</span>
          </button>
          <button class="batch-btn ghost" @click="clearSelection">
            <AppIcon name="close" :size="14" /><span>取消</span>
          </button>
        </div>
      </Transition>
    </section>

    <ContextMenu
      v-if="menu"
      :x="menu.x"
      :y="menu.y"
      :items="menuItems"
      @select="onMenuSelect"
      @close="closeMenu"
    />
    <ListAddDialog
      v-if="addDialog"
      :items="selectedItems"
      @added="onAdded"
      @close="addDialog = false"
    />
    <QualityDialog
      v-if="qualityDialog"
      :items="selectedItems"
      :list-name="board?.name"
      @added="onDownloadAdded"
      @close="qualityDialog = false"
    />

    <Transition name="toast">
      <div v-if="toast" class="toast">{{ toast }}</div>
    </Transition>
  </div>
</template>

<style scoped>
.charts {
  display: flex;
  height: 100%;
  min-height: 0;
}

/* ---------- 左栏（LX Leaderboard .lists） ---------- */
.sidebar {
  flex: none;
  width: 16%;
  min-width: 150px;
  height: 100%;
  display: flex;
  flex-direction: column;
}
.side-head {
  flex: none;
  display: flex;
  align-items: center;
  height: 38px;
  padding: 0 6px;
  border-bottom: var(--color-list-header-border-bottom);
}
.side-head .src-select {
  width: 100%;
  min-width: 0;
  height: 28px;
  padding: 0 26px 0 8px;
  border-color: transparent;
  background-color: transparent;
}
.side-lists {
  flex: 1;
  min-height: 0;
}
.side-hint {
  padding: 24px 10px;
  text-align: center;
  font-size: 12px;
  line-height: 1.6;
  color: var(--color-font-label);
}
.link-btn {
  margin-left: 6px;
  color: var(--color-primary);
}
.link-btn:hover {
  text-decoration: underline;
}
.list-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 3px;
  width: 100%;
  height: 36px;
  padding: 0 10px;
  text-align: left;
  color: var(--color-font);
  transition:
    color 0.2s ease,
    background 0.2s ease;
}
.list-item:not(.active):hover {
  background: var(--color-primary-background-hover);
}
.list-item.active {
  color: var(--color-primary);
}
.li-mark {
  flex: none;
  margin-left: -6px;
  color: var(--color-primary);
}
.li-playing {
  flex: none;
  margin-left: 6px;
  color: var(--color-primary);
}
.li-name {
  flex: 1;
  min-width: 0;
  font-size: 13px;
}

/* ---------- 右栏 ---------- */
.detail {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.detail-hint {
  padding: 40px 0;
  text-align: center;
  font-size: 13px;
  color: var(--color-font-label);
}
.track-head {
  flex: none;
  display: flex;
  align-items: center;
  height: 38px;
  padding: 0 16px;
  font-size: 12px;
  color: var(--color-font-label);
  border-bottom: var(--color-list-header-border-bottom);
}
.th {
  padding: 0 8px;
  min-width: 0;
}
.th.num {
  flex: 0 0 68px;
}
.th.name {
  flex: 1 1 auto;
}
.th.singer {
  flex: 0 0 22%;
}
.th.album {
  flex: 0 0 22%;
}
.th.time {
  flex: 0 0 9%;
}
.th.ops {
  flex: 0 0 16%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-left: 0;
  padding-right: 0;
}
.head-tools {
  display: flex;
  align-items: center;
  gap: 2px;
}
.head-tool {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: var(--form-radius);
  color: var(--color-font-label);
  transition:
    color 0.18s ease,
    background 0.18s ease;
}
.head-tool:hover:not(:disabled) {
  color: var(--color-primary);
  background: var(--color-button-background-hover);
}
.head-tool:disabled {
  opacity: 0.4;
  cursor: default;
}
.track-list {
  flex: 1;
  min-height: 0;
  padding: 6px 16px 16px;
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
