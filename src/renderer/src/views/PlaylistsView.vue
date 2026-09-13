<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useRouter } from 'vue-router'
import AppIcon from '../components/AppIcon.vue'
import BaseBtn from '../components/BaseBtn.vue'
import SongRow from '../components/SongRow.vue'
import ContextMenu, { type MenuItem } from '../components/ContextMenu.vue'
import ListAddDialog from '../components/ListAddDialog.vue'
import QualityDialog from '../components/QualityDialog.vue'
import PlaylistSortDialog from '../components/PlaylistSortDialog.vue'
import PlaylistDuplicateDialog from '../components/PlaylistDuplicateDialog.vue'
import SongIdAddDialog from '../components/SongIdAddDialog.vue'
import { useLibraryStore } from '../stores/library'
import { usePlayerStore, type QueueSource } from '../stores/player'
import { useSettingsStore } from '../stores/settings'
import { useApi } from '../composables/useApi'
import {
  getMusicItemKey,
  type LocalPlaylist,
  type MusicItem,
  type MusicSource,
  type PlatformSection,
  type PlatformSongsProgress,
  type PlayListInfoResult
} from '@common'

defineOptions({ name: 'PlaylistsView' })

const router = useRouter()
const library = useLibraryStore()
const player = usePlayerStore()
const api = useApi()
const { playlists } = storeToRefs(library)
// 「显示列表操作按钮」设置：off 时隐藏行内按钮，列头操作列收窄为仅工具按钮
const showListOps = computed(() => useSettingsStore().settings.list.showOperationButtons)

// ============ 左栏：列表清单 ============
// 系统固定入口
const trial = computed(() => playlists.value.find((p) => p.systemKind === 'trial'))
const favorites = computed(() => playlists.value.find((p) => p.systemKind === 'favorites'))
// 用户自建歌单（getPlaylists 已按 sort_order 排好序，此处保持顺序）
const customPlaylists = computed(() => playlists.value.filter((p) => !p.isSystem))

/**
 * 各平台登录后的「我的歌单」（对应 Android PlatformSection）：
 * 主进程给的是缓存快照，进入页面立即可见；后台刷新完成经 platform.onChange 推过来。
 * 按平台分组显示：组头带头像 / 昵称 / 刷新按钮（Android 平台区块的排法）。
 */
const platformSections = ref<PlatformSection[]>([])
let platformUnsub: (() => void) | null = null

async function loadPlatformSections(): Promise<void> {
  platformSections.value = await api.platform.sections().catch(() => [])
}
/** 用户主动刷新某平台：强制绕过 60s 节流 */
async function refreshPlatform(source: MusicSource): Promise<void> {
  await api.platform.refresh(source as PlatformSection['source'], true).catch(() => {})
}

// ============ 选中态与右栏歌曲 ============
type Selection =
  | { kind: 'local'; id: number; name: string }
  | { kind: 'platform'; source: MusicSource; id: string; name: string; cover?: string }

const selection = ref<Selection | null>(null)

// 选中列表持久化（刷新后回到同一列表，而不是回落「我的收藏」）
const SELECTION_KEY = 'kunyin:playlists:selection'
function saveSelection(): void {
  try {
    localStorage.setItem(SELECTION_KEY, JSON.stringify(selection.value ?? null))
  } catch {
    /* ignore */
  }
}
function readSavedSelection(): Selection | null {
  try {
    return JSON.parse(localStorage.getItem(SELECTION_KEY) ?? 'null') as Selection | null
  } catch {
    return null
  }
}
const tracks = ref<MusicItem[]>([])
const loadingTracks = ref(false)
/** 平台歌单：远端总曲数（接口没给时为空）、是否已拉齐、拉取失败提示 */
const tracksTotal = ref<number | undefined>()
const tracksComplete = ref(true)
const tracksError = ref('')
/** 正在后台补齐的平台歌单批次；逐页推送按它过滤，切列表 / 重新拉取即失效 */
let songsRun: { source: MusicSource; id: string; runId: number } | null = null
const searchText = ref('')
const searchOpen = ref(false)
function toggleSearch(): void {
  searchOpen.value = !searchOpen.value
  if (!searchOpen.value) searchText.value = ''
}

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
  saveSelection()
  searchText.value = ''
  clearSelection()
  await loadTracks()
}
async function selectPlatform(g: PlatformSection, p: PlayListInfoResult): Promise<void> {
  selection.value = { kind: 'platform', source: g.source, id: p.id, name: p.name, cover: p.cover }
  saveSelection()
  searchText.value = ''
  clearSelection()
  await loadTracks()
}

/**
 * 载入右栏曲目。平台歌单走 platform.songs：完整缓存命中立即返回；否则首页到手就先显示，
 * 余页由主进程后台补齐、经 onSongsProgress 逐页追加（对齐 Android「首页 + 静默补齐」）。
 *
 * - force：用户主动「重新拉取」平台歌单，忽略缓存；
 * - silent：列表已在显示、只是内容变了（删歌 / 排序 / 导入）——原地替换数据，不切「加载中…」占位。
 *   否则滚动容器会被卸载重挂、滚动位置回到顶部（右键删一首歌就跳回顶部的根因）。
 */
async function loadTracks(opts: { force?: boolean; silent?: boolean } = {}): Promise<void> {
  const s = selection.value
  if (!s) {
    tracks.value = []
    songsRun = null
    return
  }
  const silent = !!opts.silent && tracks.value.length > 0
  if (!silent) loadingTracks.value = true
  tracksError.value = ''
  const token = selectedKey.value
  try {
    if (s.kind === 'local') {
      const list = await library.playlistSongs(s.id)
      if (token !== selectedKey.value) return // 已切列表则丢弃过期结果
      tracks.value = list
      tracksTotal.value = undefined
      tracksComplete.value = true
      songsRun = null
    } else {
      const snap = await api.platform.songs(
        s.source as PlatformSection['source'],
        s.id,
        !!opts.force
      )
      if (token !== selectedKey.value) return
      tracks.value = snap.songs
      tracksTotal.value = snap.total
      tracksComplete.value = snap.complete
      tracksError.value = snap.error ?? ''
      songsRun = snap.complete ? null : { source: snap.source, id: snap.id, runId: snap.runId }
    }
  } catch (e) {
    if (token === selectedKey.value)
      tracksError.value = e instanceof Error ? e.message : '歌单加载失败'
  } finally {
    if (token === selectedKey.value && !silent) loadingTracks.value = false
  }
}

/** 主进程后台补齐的一页到了：追加到右栏；若正在播放的就是这个列表，同步补进播放队列 */
function onSongsProgress(p: PlatformSongsProgress): void {
  const run = songsRun
  if (!run || p.runId !== run.runId || p.source !== run.source || p.id !== run.id) return
  if (p.added.length) {
    const keys = new Set(tracks.value.map(getMusicItemKey))
    const fresh = p.added.filter((t) => !keys.has(getMusicItemKey(t)))
    if (fresh.length) {
      tracks.value.push(...fresh)
      // 队列 = 所见列表；有搜索过滤时队列是过滤后的子集，不往里塞未过滤的新歌
      const src = playSource()
      if (src && !searchText.value.trim()) player.appendToQueue(fresh, src)
    }
  }
  if (p.total) tracksTotal.value = p.total
  if (p.error) tracksError.value = p.error
  if (p.complete) {
    tracksComplete.value = true
    songsRun = null
  }
}

function isActive(item: MusicItem): boolean {
  return !!player.current && getMusicItemKey(player.current) === getMusicItemKey(item)
}
/** 当前选中列表作为播放队列来源（供「正在播放的列表」标记） */
function playSource(): QueueSource | undefined {
  const s = selection.value
  if (!s) return undefined
  if (s.kind === 'local') return { kind: 'local', id: String(s.id), name: s.name }
  return { kind: 'platform', id: `${s.source}:${s.id}`, name: s.name }
}
/** 正在播放的队列所属列表在左栏的 key（与 selectedKey 同构；single 无对应项返回空） */
const playingKey = computed(() => {
  const s = player.queueSource
  if (!s) return ''
  // 搜索点单曲的队列来源是「试听列表」，对应左栏系统列表
  if (s.kind === 'trial') {
    const t = playlists.value.find((p) => p.systemKind === 'trial')
    return t ? `local:${t.id}` : ''
  }
  if (s.kind === 'local') return `local:${s.id}`
  if (s.kind === 'platform') return `platform:${s.id}`
  return ''
})
/** 浏览的列表 ≠ 正在播放的队列来源时提示（解释「播放中的列表」与所见列表不同步） */
const showQueueHint = computed(
  () => playingKey.value !== '' && playingKey.value !== selectedKey.value
)
function play(item: MusicItem): void {
  // 队列 = 当前所见列表（含搜索过滤后的结果），保证「下一首」与界面一致
  player.playItem(item, filteredTracks.value, { source: playSource() })
}
function playAll(): void {
  const list = filteredTracks.value
  if (list.length) player.playItem(list[0], list, { source: playSource() })
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
/**
 * 行点击（对齐 LX handleSelectData）：
 * - 普通单击：不选中；若已有选中则清空。播放靠双击、菜单靠右键。
 * - Ctrl/Cmd+单击：切换该曲选中，并把它设为区间锚点。
 * - Shift+单击：以锚点为端点做区间选中（替换现有选择）。
 */
function onRowSelect(e: MouseEvent, index: number): void {
  const list = filteredTracks.value
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
  if (items.length) player.playItem(items[0], items, { source: playSource() })
}
async function removeSelected(): Promise<void> {
  const s = selection.value
  if (s?.kind !== 'local') return
  for (const item of selectedItems.value) await library.removeFromPlaylist(s.id, item)
  clearSelection()
  showToast('已从列表移除')
}
// 批量下载：先弹音质选择（逐首回退到可用的最接近档位）
const qualityDialog = ref(false)
function downloadSelected(): void {
  qualityDialog.value = true
}
function onDownloadAdded(): void {
  showToast(`已加入下载 ${selectedItems.value.length} 首`)
  clearSelection()
}

// 批量「添加到列表」弹窗（LX ListAddMultipleModal）
const addDialog = ref(false)
function onAdded(): void {
  showToast(`已添加 ${selectedItems.value.length} 首到列表`)
  clearSelection()
}

// 安卓版「通过歌曲 ID / MID 导入」：仅本地列表可写
const idAddTarget = ref<{ id: number; name: string } | null>(null)
function openIdAddDialog(target?: { id: number; name: string }): void {
  if (target) {
    idAddTarget.value = target
    return
  }
  const s = selection.value
  if (s?.kind === 'local') idAddTarget.value = { id: s.id, name: s.name }
}
function onSongImported(item: MusicItem): void {
  const target = idAddTarget.value
  showToast(`已导入：${item.title}`)
  if (target && selection.value?.kind === 'local' && selection.value.id === target.id) {
    void loadTracks({ silent: true })
  }
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

// ============ 右键菜单（项与顺序对齐 LX Music 列表菜单） ============
interface MenuState {
  x: number
  y: number
  playlist: LocalPlaylist
}
const menu = ref<MenuState | null>(null)
const menuItems = computed<MenuItem[]>(() => {
  const p = menu.value?.playlist
  if (!p) return []
  const remote = !!(p.remoteSource && p.remoteId)
  return [
    { key: 'play', label: '播放', icon: 'play' },
    { key: 'rename', label: '重命名', icon: 'edit', disabled: p.isSystem },
    { key: 'sort', label: '排序歌曲', icon: 'sort', divider: true },
    { key: 'duplicate', label: '重复歌曲', icon: 'copy' },
    { key: 'addLocal', label: '添加本地歌曲', icon: 'folder' },
    { key: 'addById', label: '通过 ID / MID 添加歌曲', icon: 'plus' },
    { key: 'update', label: '更新', icon: 'refresh', divider: true, disabled: !remote },
    {
      key: 'autoRefresh',
      label: p.autoRefresh ? '关闭启动时自动补充新曲' : '启动时自动补充新曲',
      icon: 'refresh',
      disabled: !remote
    },
    { key: 'detail', label: '歌单详情页', icon: 'library', disabled: !remote },
    { key: 'import', label: '导入', icon: 'download', divider: true },
    { key: 'export', label: '导出', icon: 'upload' },
    { key: 'delete', label: '移除', icon: 'trash', danger: true, disabled: p.isSystem }
  ]
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
  if (key === 'autoRefresh') {
    await api.library.setAutoRefresh(p.id, !p.autoRefresh)
    showToast(p.autoRefresh ? '已关闭自动更新' : '启动时将自动补充远端新曲，保留本地歌曲')
    return
  }
  if (key === 'play') {
    await selectLocal(p)
    playAll()
  } else if (key === 'rename') {
    void startRename(p)
  } else if (key === 'sort') {
    sortTarget.value = p
  } else if (key === 'duplicate') {
    dupTarget.value = p
  } else if (key === 'addLocal') {
    void addLocalSongs(p)
  } else if (key === 'addById') {
    openIdAddDialog(p)
  } else if (key === 'update') {
    void updateFromRemote(p)
  } else if (key === 'detail') {
    void router.push({
      name: 'playlist',
      params: { playlistId: p.remoteId },
      query: { source: p.remoteSource }
    })
  } else if (key === 'import') {
    void importList()
  } else if (key === 'delete') {
    pendingDelete.value = p
  } else if (key === 'export') {
    void exportList(p)
  }
}

// ============ 平台歌单右键菜单 ============
// 对应 Android 平台歌单项的操作：重新拉取（绕过缓存）、创建本地副本（copyPlatformPlaylistToLocal）、详情页
interface PlatformMenuState {
  x: number
  y: number
  section: PlatformSection
  playlist: PlayListInfoResult
}
const platformMenu = ref<PlatformMenuState | null>(null)
const platformMenuItems: MenuItem[] = [
  { key: 'play', label: '播放', icon: 'play' },
  { key: 'reload', label: '重新拉取', icon: 'refresh', divider: true },
  { key: 'copy', label: '创建本地副本', icon: 'copy' },
  { key: 'detail', label: '歌单详情页', icon: 'library' }
]
function openPlatformMenu(e: MouseEvent, section: PlatformSection, p: PlayListInfoResult): void {
  closeMenu()
  platformMenu.value = { x: e.clientX, y: e.clientY, section, playlist: p }
}
async function onPlatformMenuSelect(key: string): Promise<void> {
  const m = platformMenu.value
  platformMenu.value = null
  if (!m) return
  if (key === 'play') {
    await selectPlatform(m.section, m.playlist)
    playAll()
  } else if (key === 'reload') {
    await selectPlatform(m.section, m.playlist)
    await loadTracks({ force: true })
    if (tracksError.value) showToast(tracksError.value)
    else if (tracksComplete.value)
      showToast(`已重新拉取「${m.playlist.name}」：${tracks.value.length} 首`)
    else showToast(`正在重新拉取「${m.playlist.name}」，余下歌曲会陆续补齐`)
  } else if (key === 'copy') {
    void copyPlatformToLocal(m.section, m.playlist)
  } else if (key === 'detail') {
    void router.push({
      name: 'playlist',
      params: { playlistId: m.playlist.id },
      query: { source: m.section.source, title: m.playlist.name, cover: m.playlist.cover ?? '' }
    })
  }
}
/** 创建本地副本：复用 importRemote（绑定远端来源，之后可「更新」/「启动时自动补充新曲」） */
async function copyPlatformToLocal(section: PlatformSection, p: PlayListInfoResult): Promise<void> {
  showToast(`正在创建「${p.name}」的本地副本…`)
  try {
    const id = await api.library.importRemote(section.source, p.id, p.name)
    await library.refresh().catch(() => {})
    const created = playlists.value.find((pl) => pl.id === id)
    showToast(`已创建本地副本「${created?.name ?? p.name}」`)
  } catch (e) {
    showToast(e instanceof Error ? e.message : '创建本地副本失败')
  }
}

// ============ 排序歌曲 / 重复歌曲 弹窗 ============
const sortTarget = ref<LocalPlaylist | null>(null)
const dupTarget = ref<LocalPlaylist | null>(null)
function onSorted(): void {
  showToast('已重新排序')
  if (selection.value?.kind === 'local') void loadTracks({ silent: true })
}

// ============ 添加本地歌曲 ============
async function addLocalSongs(p: LocalPlaylist): Promise<void> {
  const r = await api.library.addLocalSongs(p.id).catch(() => null)
  if (!r) return // 用户取消或失败
  showToast(
    r.skipped > 0 ? `已添加 ${r.added} 首（跳过 ${r.skipped} 首重复/失败）` : `已添加 ${r.added} 首`
  )
}

// ============ 更新（远端绑定歌单重新拉取整单替换） ============
const updatingId = ref<number | null>(null)
async function updateFromRemote(p: LocalPlaylist): Promise<void> {
  if (!p.remoteSource || !p.remoteId || updatingId.value != null) return
  updatingId.value = p.id
  showToast(`正在更新「${p.name}」…`)
  try {
    const count = await api.library.refreshRemote(p.id)
    showToast('已更新「' + p.name + '」：' + count + ' 首')
  } catch (e) {
    showToast(e instanceof Error ? e.message : '更新失败')
  } finally {
    updatingId.value = null
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
let progressUnsub: (() => void) | null = null
onMounted(async () => {
  await library.refresh().catch(() => {})
  // 先显示缓存快照，再让主进程后台刷新（60s 节流，频繁进出页面不会反复打接口）
  void loadPlatformSections()
  void api.platform.refresh().catch(() => {})
  platformUnsub = api.platform.onChange(() => void loadPlatformSections())
  progressUnsub = api.platform.onSongsProgress(onSongsProgress)
  // 曲库变更（收藏/删歌/排序）时静默刷新右栏，保住滚动位置；playlists 列表由 App 层全局订阅刷新
  libraryUnsub = api.library.onChange(() => {
    if (selection.value?.kind === 'local') void loadTracks({ silent: true })
  })
  // 恢复上次选中的列表；本地列表校验仍存在（可能已被删除/重命名），失效回落「我的收藏」
  const saved = readSavedSelection()
  if (saved?.kind === 'local') {
    const p = playlists.value.find((pl) => pl.id === saved.id)
    if (p) {
      void selectLocal(p)
      return
    }
  } else if (saved?.kind === 'platform') {
    // 平台歌单直接按 source:id 拉曲目，不依赖分组先加载完
    selection.value = saved
    void loadTracks()
    return
  }
  if (!selection.value && favorites.value) void selectLocal(favorites.value)
})
onUnmounted(() => {
  platformUnsub?.()
  libraryUnsub?.()
  progressUnsub?.()
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

      <div class="side-lists scroll">
        <!-- 系统列表 / 自建列表 / 平台歌单：全部平铺（LX MyList） -->
        <button
          v-if="trial"
          class="list-item"
          :class="{ active: selectedKey === `local:${trial.id}` }"
          @click="trial && selectLocal(trial)"
          @contextmenu.prevent.stop="trial && openMenu($event, trial)"
        >
          <AppIcon
            v-if="selectedKey === `local:${trial.id}`"
            name="chevron-right"
            :size="12"
            class="li-mark"
          />
          <span class="li-name ellipsis">试听列表</span>
          <AppIcon
            v-if="playingKey === `local:${trial.id}`"
            name="headphone"
            :size="13"
            class="li-playing"
            title="正在播放此列表"
          />
        </button>
        <button
          v-if="favorites"
          class="list-item"
          :class="{ active: selectedKey === `local:${favorites.id}` }"
          @click="favorites && selectLocal(favorites)"
          @contextmenu.prevent.stop="favorites && openMenu($event, favorites)"
        >
          <AppIcon
            v-if="selectedKey === `local:${favorites.id}`"
            name="chevron-right"
            :size="12"
            class="li-mark"
          />
          <span class="li-name ellipsis">我的收藏</span>
          <AppIcon
            v-if="playingKey === `local:${favorites.id}`"
            name="headphone"
            :size="13"
            class="li-playing"
            title="正在播放此列表"
          />
        </button>

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
            <AppIcon
              v-if="selectedKey === `local:${p.id}`"
              name="chevron-right"
              :size="12"
              class="li-mark"
            />
            <span class="li-name ellipsis">{{ p.name }}</span>
            <AppIcon
              v-if="playingKey === `local:${p.id}`"
              name="headphone"
              :size="13"
              class="li-playing"
              title="正在播放此列表"
            />
          </button>
        </template>

        <!-- 平台「我的歌单」：按平台分组，组头 = 头像 + 昵称 + 刷新（Android PlatformSection） -->
        <template v-for="sec in platformSections" :key="`section:${sec.source}`">
          <div class="section-head">
            <img
              v-if="sec.userInfo?.avatar"
              :src="sec.userInfo.avatar"
              class="sec-avatar"
              alt=""
              referrerpolicy="no-referrer"
            />
            <span v-else class="sec-avatar sec-avatar-empty"></span>
            <span class="sec-name ellipsis">
              {{ sec.userInfo?.nickname || sec.displayName }}
            </span>
            <span class="sec-tag">{{ sec.displayName }}</span>
            <button
              class="sec-refresh"
              :class="{ spinning: sec.loading }"
              :disabled="sec.loading"
              :title="sec.loading ? '正在刷新…' : '刷新歌单列表'"
              @click.stop="refreshPlatform(sec.source)"
            >
              <AppIcon name="refresh" :size="13" />
            </button>
          </div>
          <div v-if="!sec.playlists.length" class="sec-empty">
            {{ sec.loading ? '正在获取歌单…' : '没有歌单' }}
          </div>
          <button
            v-for="p in sec.playlists"
            :key="`platform:${sec.source}:${p.id}`"
            class="list-item"
            :class="{ active: selectedKey === `platform:${sec.source}:${p.id}` }"
            @click="selectPlatform(sec, p)"
            @contextmenu.prevent.stop="openPlatformMenu($event, sec, p)"
          >
            <AppIcon
              v-if="selectedKey === `platform:${sec.source}:${p.id}`"
              name="chevron-right"
              :size="12"
              class="li-mark"
            />
            <span class="li-name ellipsis">{{ p.name }}</span>
            <span v-if="p.total" class="li-count">{{ p.total }}</span>
            <AppIcon
              v-if="playingKey === `platform:${sec.source}:${p.id}`"
              name="headphone"
              :size="13"
              class="li-playing"
              title="正在播放此列表"
            />
          </button>
        </template>

        <!-- 新建列表输入行：位于列表末尾（LX） -->
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
      </div>
    </aside>

    <!-- 右栏：选中列表的歌曲 -->
    <section class="detail">
      <div v-if="!selection" class="detail-empty">选择左侧列表查看歌曲</div>
      <template v-else>
        <!-- 列头 -->
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
                v-if="selection.kind === 'local'"
                class="head-tool"
                title="通过 ID / MID 添加歌曲"
                @click="openIdAddDialog()"
              >
                <AppIcon name="plus" :size="14" />
              </button>
              <button
                v-if="player.current"
                class="head-tool"
                title="定位当前播放"
                @click="locateCurrent"
              >
                <AppIcon name="locate" :size="14" />
              </button>
              <button
                class="head-tool"
                :class="{ on: searchOpen }"
                title="搜索列表内歌曲"
                @click="toggleSearch"
              >
                <AppIcon name="search" :size="14" />
              </button>
            </span>
          </div>
        </div>

        <!-- 正在播放的队列来自其他列表时提示（当前所见 ≠ 播放队列） -->
        <div v-if="showQueueHint" class="queue-hint">
          <AppIcon name="headphone" :size="13" />
          <span class="qh-text ellipsis">
            正在播放「{{ player.queueSource?.name || '其他列表' }}」的队列（{{
              player.queue.length
            }}
            首）——点歌或「播放全部」将切换到本列表
          </span>
        </div>

        <!-- 列表内搜索（切换显示） -->
        <div v-if="searchOpen" class="search-row">
          <AppIcon name="search" :size="14" />
          <input v-model="searchText" placeholder="搜索当前列表内歌曲" autofocus />
          <span class="search-count">{{ filteredTracks.length }} 首</span>
        </div>

        <div v-if="loadingTracks" class="detail-hint">加载中…</div>
        <div v-else-if="tracksError && !tracks.length" class="detail-hint" role="alert">
          <span>{{ tracksError }}</span>
          <BaseBtn min @click="loadTracks({ force: true })">重试</BaseBtn>
        </div>
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
          <!-- 平台歌单：首页已显示，余下页由主进程后台补齐中 -->
          <div v-if="!tracksComplete" class="list-foot">
            正在加载余下歌曲… 已加载 {{ tracks.length }}
            <template v-if="tracksTotal">/ {{ tracksTotal }}</template> 首
          </div>
          <div
            v-else-if="tracksError && selection.kind === 'platform'"
            class="list-foot"
            role="alert"
          >
            <span>{{ tracksError }}（已加载 {{ tracks.length }} 首）</span>
            <BaseBtn min @click="loadTracks({ force: true })">重新拉取</BaseBtn>
          </div>
        </div>

        <!-- 批量操作栏 -->
        <Transition name="batchbar">
          <div v-if="selectedCount" class="batch-bar">
            <span class="batch-count">已选 {{ selectedCount }} 首</span>
            <button class="batch-btn" @click="playSelected">
              <AppIcon name="play" :size="14" /><span>播放</span>
            </button>
            <button class="batch-btn" @click="addDialog = true">
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

    <!-- 平台歌单右键菜单 -->
    <ContextMenu
      v-if="platformMenu"
      :x="platformMenu.x"
      :y="platformMenu.y"
      :items="platformMenuItems"
      @select="onPlatformMenuSelect"
      @close="platformMenu = null"
    />

    <!-- 排序歌曲弹窗 -->
    <PlaylistSortDialog
      v-if="sortTarget"
      :playlist-id="sortTarget.id"
      :playlist-name="sortTarget.name"
      @sorted="onSorted"
      @close="sortTarget = null"
    />

    <!-- 重复歌曲弹窗 -->
    <PlaylistDuplicateDialog
      v-if="dupTarget"
      :playlist-id="dupTarget.id"
      :playlist-name="dupTarget.name"
      @close="dupTarget = null"
    />

    <!-- 批量「添加到列表」弹窗 -->
    <ListAddDialog
      v-if="addDialog"
      :items="selectedItems"
      @added="onAdded"
      @close="addDialog = false"
    />

    <!-- 批量下载音质选择 -->
    <QualityDialog
      v-if="qualityDialog"
      :items="selectedItems"
      :list-name="selection?.name"
      @added="onDownloadAdded"
      @close="qualityDialog = false"
    />

    <!-- 通过平台歌曲 ID / MID 添加到本地歌单 -->
    <SongIdAddDialog
      v-if="idAddTarget"
      :playlist-id="idAddTarget.id"
      :playlist-name="idAddTarget.name"
      @added="onSongImported"
      @close="idAddTarget = null"
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

/* ---------- 左栏（LX MyList） ---------- */
.sidebar {
  flex: none;
  width: 16%;
  height: 100%;
  display: flex;
  flex-direction: column;
}
.side-head {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 38px;
  padding: 0 4px 0 10px;
  border-bottom: var(--color-list-header-border-bottom);
}
/* LX：按钮平时近乎隐身，悬停表头才显现 */
.side-head:hover .icon-btn {
  opacity: 1;
}
.side-lists {
  flex: 1;
  min-height: 0;
}
.side-actions {
  display: flex;
  align-items: center;
}
.side-title {
  font-size: 12px;
  font-weight: 400;
  color: var(--color-font);
}
.icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 30px;
  border-radius: var(--radius-border);
  color: var(--color-button-font);
  opacity: 0.1;
  transition: opacity var(--transition-normal);
}
.icon-btn:hover {
  opacity: 0.6 !important;
}
.icon-btn:active {
  opacity: 0.7 !important;
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
.list-item.drop-over {
  box-shadow: inset 0 2px 0 var(--color-primary);
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
.li-count {
  flex: none;
  font-size: 11px;
  color: var(--color-font-label);
}

/* 平台分组头（头像 + 昵称 + 平台名 + 刷新） */
.section-head {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  margin-top: 6px;
  padding: 0 10px;
  border-top: var(--color-list-header-border-bottom);
}
.sec-avatar {
  flex: none;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  object-fit: cover;
  background: var(--color-primary-background);
}
.sec-avatar-empty {
  display: inline-block;
}
.sec-name {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  color: var(--color-font);
}
.sec-tag {
  flex: none;
  font-size: 10px;
  color: var(--color-font-label);
}
.sec-refresh {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: var(--form-radius);
  color: var(--color-font-label);
  transition:
    color 0.18s ease,
    background 0.18s ease;
}
.sec-refresh:hover:not(:disabled) {
  color: var(--color-primary);
  background: var(--color-button-background-hover);
}
.sec-refresh.spinning :deep(svg) {
  animation: sec-spin 1s linear infinite;
}
@keyframes sec-spin {
  to {
    transform: rotate(360deg);
  }
}
.sec-empty {
  padding: 6px 10px;
  font-size: 12px;
  color: var(--color-font-label);
}

/* 新建/重命名输入行（LX editing 态） */
.create-row {
  padding: 0 10px;
  background: var(--color-primary-background-hover);
}
.inline-input {
  width: 100%;
  height: 36px;
  padding: 0;
  border-radius: 0;
  font-size: 13px;
  color: var(--color-font);
  background: none;
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
.detail-hint,
.list-foot {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 10px;
}
/* 列表尾部：后台补齐进度 / 失败重试 */
.list-foot {
  padding: 16px 0 8px;
  font-size: 12px;
  color: var(--color-font-label);
}

/* ---------- 列头（LX 表格式） ---------- */
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
.head-tool:hover,
.head-tool.on {
  color: var(--color-primary);
  background: var(--color-button-background-hover);
}

/* ---------- 正在播放队列来源提示 ---------- */
.queue-hint {
  flex: none;
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 8px 16px 0;
  padding: 7px 12px;
  border-radius: var(--form-radius);
  font-size: 12px;
  color: var(--color-primary);
  background: var(--color-primary-background);
}
.qh-text {
  min-width: 0;
  color: var(--color-font);
}

/* ---------- 列表内搜索行 ---------- */
.search-row {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 8px 16px 0;
  padding: 7px 12px;
  border-radius: var(--form-radius);
  color: var(--color-font-label);
  background: var(--color-primary-background);
}
.search-row input {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  color: var(--color-font);
}
.search-count {
  flex: none;
  font-size: 12px;
  color: var(--color-font-label);
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
