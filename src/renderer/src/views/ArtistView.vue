<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import AppIcon from '../components/AppIcon.vue'
import AppTabs from '../components/AppTabs.vue'
import ListAddDialog from '../components/ListAddDialog.vue'
import QualityDialog from '../components/QualityDialog.vue'
import SongRow from '../components/SongRow.vue'
import { usePlayerStore, type QueueSource } from '../stores/player'
import { useMvStore } from '../stores/mv'
import { useSettingsStore } from '../stores/settings'
import { useArtistStore, type ArtistTab } from '../stores/artist'
import { coverUrl } from '../utils/cover'
import { getMusicItemKey, type AlbumInfoResult, type MusicItem, type MusicSource } from '@common'

defineOptions({ name: 'ArtistView' })

const route = useRoute()
const router = useRouter()
const player = usePlayerStore()
const mv = useMvStore()
const settingsStore = useSettingsStore()
const artist = useArtistStore()
const {
  info,
  loading,
  error,
  tab,
  showAlbumsTab,
  showMvsTab,
  songs,
  songsLoadingMore,
  songsHasMore,
  albums,
  albumsLoading,
  albumsHasMore,
  mvs,
  mvsLoading,
  mvsHasMore
} = storeToRefs(artist)

/** artistKey 编码为 `source:id`（source 也可走 query.source） */
function parseKey(): { source: MusicSource; id: string } | null {
  const raw = String(route.params.artistKey ?? '')
  const qs = route.query.source as MusicSource | undefined
  if (qs) return raw ? { source: qs, id: raw } : null
  const idx = raw.indexOf(':')
  if (idx <= 0) return null
  return { source: raw.slice(0, idx) as MusicSource, id: raw.slice(idx + 1) }
}

watch(
  () => [route.params.artistKey, route.query.source],
  () => {
    const key = parseKey()
    if (key) void artist.load(key.source, key.id)
  },
  { immediate: true }
)

// ============ 头部 ============
const metaText = computed(() => {
  const parts: string[] = []
  const albumCount = info.value?.albumCount ?? 0
  if (albumCount > 0) parts.push(`${albumCount} 张专辑`)
  const songCount = info.value?.songCount || songs.value.length
  if (songCount > 0) parts.push(`${songCount} 首歌曲`)
  return parts.join(' · ')
})

/** 粉丝数缩写：亿 / 万（对应 Android formatFans） */
function formatFans(count: number): string {
  if (count >= 100_000_000) return `${(count / 100_000_000).toFixed(1)}亿`
  if (count >= 10_000) return `${(count / 10_000).toFixed(1)}万`
  return String(count)
}

const descExpanded = ref(false)

// ============ Tab ============
const tabs = computed(() => {
  const list: { id: ArtistTab; label: string }[] = [{ id: 'songs', label: '歌曲' }]
  if (showAlbumsTab.value) {
    const n = info.value?.albumCount ?? 0
    list.push({ id: 'albums', label: n > 0 ? `专辑 ${n}` : '专辑' })
  }
  if (showMvsTab.value) list.push({ id: 'mvs', label: 'MV' })
  return list
})

function switchTab(id: string): void {
  if (id !== 'songs') exitSelection()
  artist.selectTab(id as ArtistTab)
}

// ============ 滚动到底自动加载更多（对应 Android LazyColumn 的 shouldLoadMore） ============
function onScroll(e: Event): void {
  const el = e.target as HTMLElement
  if (el.scrollTop + el.clientHeight < el.scrollHeight - 240) return
  if (tab.value === 'songs') void artist.loadMoreSongs()
  else if (tab.value === 'albums') void artist.loadMoreAlbums()
  else void artist.loadMoreMvs()
}

// ============ 歌曲 ============
function isActive(item: MusicItem): boolean {
  return !!player.current && getMusicItemKey(player.current) === getMusicItemKey(item)
}
/** 歌手歌曲列表作为播放队列来源 */
function playSource(): QueueSource | undefined {
  const key = parseKey()
  if (!key) return undefined
  return { kind: 'platform', id: `${key.source}:${key.id}`, name: info.value?.name ?? '' }
}
function play(item: MusicItem): void {
  player.playItem(item, songs.value, { trackTrial: true, source: playSource() })
}
function playAll(): void {
  if (songs.value.length) play(songs.value[0])
}

// ============ 多选（对应 Android selectionMode + SelectionBottomBar） ============
const selection = ref<MusicItem[]>([])
const selectionMode = computed(() => selection.value.length > 0)
const addDialog = ref(false)
const qualityDialog = ref(false)

function isSelected(item: MusicItem): boolean {
  const key = getMusicItemKey(item)
  return selection.value.some((s) => getMusicItemKey(s) === key)
}
function toggleSelect(item: MusicItem): void {
  const key = getMusicItemKey(item)
  const idx = selection.value.findIndex((s) => getMusicItemKey(s) === key)
  if (idx >= 0) selection.value.splice(idx, 1)
  else selection.value.push(item)
}
function exitSelection(): void {
  selection.value = []
}
function selectAll(): void {
  selection.value = selection.value.length === songs.value.length ? [] : [...songs.value]
}
/** 点击行：多选态下切换勾选，否则播放 */
function onRowClick(item: MusicItem, e: MouseEvent): void {
  if (selectionMode.value || e.ctrlKey || e.metaKey) toggleSelect(item)
  else play(item)
}
function playSelectedNext(): void {
  for (const item of selection.value) player.playNext(item)
  exitSelection()
}

// ============ 专辑 ============
const albumListMode = computed(() => settingsStore.settings.list.albumListMode)
function toggleAlbumListMode(): void {
  void settingsStore.update({ list: { albumListMode: !albumListMode.value } })
}
function openAlbum(a: AlbumInfoResult): void {
  void router.push({ name: 'album', params: { albumKey: a.id }, query: { source: a.source } })
}
/** 发行日期 → 年份（接口给的是 `yyyy-MM-dd` 或时间戳字符串） */
function year(publishTime: string | undefined): string {
  if (!publishTime) return ''
  const m = /^(\d{4})/.exec(publishTime)
  if (m) return m[1]
  const ts = Number(publishTime)
  return Number.isFinite(ts) && ts > 0 ? String(new Date(ts).getFullYear()) : ''
}
function albumSub(a: AlbumInfoResult): string {
  return [year(a.publishTime), a.subType, a.total ? `${a.total} 首` : '']
    .filter(Boolean)
    .join(' · ')
}
function albumRowSub(a: AlbumInfoResult): string {
  return [a.artist, year(a.publishTime), a.subType, a.total ? `${a.total} 首` : '']
    .filter(Boolean)
    .join(' · ')
}

// ============ MV ============
function fmtDuration(seconds: number | undefined): string {
  if (!seconds) return ''
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
}
/** 点 MV：主进程造占位 item 后交给 MvPlayer 取流播放 */
async function openMv(item: { vid: string; title: string; cover: string }): Promise<void> {
  const src = info.value?.source ?? parseKey()?.source
  if (!src) return
  const placeholder = await window.api.discover
    .artistMvItem(src, item.vid, item.title, item.cover)
    .catch(() => null)
  if (placeholder) mv.open(placeholder)
}
</script>

<template>
  <div class="artist-view">
    <div class="body scroll" @scroll.passive="onScroll">
      <!-- 头部：圆形头像 + 名称 + 专辑/歌曲数 + 粉丝 + 播放全部 -->
      <div class="ar-header">
        <div class="ar-avatar">
          <img v-if="info?.cover" :src="coverUrl(info.cover)" alt="" />
          <AppIcon v-else name="library" :size="40" />
        </div>
        <div class="ar-info">
          <div class="ar-name ellipsis-2">{{ info?.name || (loading ? '加载中…' : '歌手') }}</div>
          <div v-if="metaText" class="ar-meta">{{ metaText }}</div>
          <div v-if="info?.fansCount" class="ar-fans">{{ formatFans(info.fansCount) }} 粉丝</div>
          <div class="ar-actions">
            <button class="play-all" :disabled="!songs.length" @click="playAll">
              <AppIcon name="play" :size="16" />
              <span>播放全部</span>
            </button>
          </div>
        </div>
      </div>

      <!-- 歌手简介（长文折叠，对应 Android maxLines=6） -->
      <div v-if="info?.description" class="ar-desc" :class="{ expanded: descExpanded }">
        <p>{{ info.description }}</p>
        <button class="ar-desc-toggle" @click="descExpanded = !descExpanded">
          {{ descExpanded ? '收起' : '展开' }}
        </button>
      </div>

      <div v-if="error && !songs.length" class="state">
        <span>{{ error }}</span>
        <button class="retry" @click="artist.retry()">重试</button>
      </div>

      <template v-else>
        <AppTabs
          v-if="tabs.length > 1"
          class="ar-tabs"
          :model-value="tab"
          :list="tabs"
          @change="switchTab"
        />

        <!-- ============ 歌曲 ============ -->
        <template v-if="tab === 'songs'">
          <div v-if="loading && !songs.length" class="hint">加载中…</div>
          <div v-else-if="!songs.length" class="hint">该歌手暂无热门歌曲</div>
          <div v-else class="list">
            <SongRow
              v-for="(t, i) in songs"
              :key="getMusicItemKey(t)"
              :item="t"
              :index="i"
              :active="isActive(t)"
              :selected="isSelected(t)"
              @play="play(t)"
              @select="onRowClick(t, $event)"
            />
            <div v-if="songsLoadingMore" class="hint">加载中…</div>
            <div v-else-if="!songsHasMore && songs.length > 20" class="hint">没有更多了</div>
          </div>
        </template>

        <!-- ============ 专辑（网格 / 列表可切换，模式持久化到设置） ============ -->
        <template v-else-if="tab === 'albums'">
          <div class="ar-toolbar">
            <button
              class="icon-btn"
              :title="albumListMode ? '网格视图' : '列表视图'"
              @click="toggleAlbumListMode"
            >
              <AppIcon :name="albumListMode ? 'flex' : 'display'" :size="16" />
            </button>
          </div>
          <div v-if="albumsLoading && !albums.length" class="hint">加载中…</div>
          <div v-else-if="!albums.length" class="hint">该歌手暂无专辑</div>
          <template v-else>
            <div v-if="albumListMode" class="album-rows">
              <button
                v-for="a in albums"
                :key="`${a.source}_${a.id}`"
                class="album-row"
                @click="openAlbum(a)"
              >
                <img
                  v-if="a.cover"
                  class="ar-cover sm"
                  :src="coverUrl(a.cover)"
                  loading="lazy"
                  alt=""
                />
                <div v-else class="ar-cover sm placeholder">
                  <AppIcon name="library" :size="20" />
                </div>
                <div class="album-row-meta">
                  <span class="album-name ellipsis">{{ a.name }}</span>
                  <span v-if="albumRowSub(a)" class="album-sub ellipsis">{{ albumRowSub(a) }}</span>
                </div>
              </button>
            </div>
            <div v-else class="album-grid">
              <button
                v-for="a in albums"
                :key="`${a.source}_${a.id}`"
                class="album-card"
                @click="openAlbum(a)"
              >
                <img
                  v-if="a.cover"
                  class="album-cover"
                  :src="coverUrl(a.cover)"
                  loading="lazy"
                  alt=""
                />
                <div v-else class="album-cover placeholder">
                  <AppIcon name="library" :size="26" />
                </div>
                <span class="album-name ellipsis">{{ a.name }}</span>
                <span v-if="albumSub(a)" class="album-sub ellipsis">{{ albumSub(a) }}</span>
              </button>
            </div>
            <div v-if="albumsLoading" class="hint">加载中…</div>
            <div v-else-if="!albumsHasMore" class="hint">没有更多了</div>
          </template>
        </template>

        <!-- ============ MV ============ -->
        <template v-else>
          <div v-if="mvsLoading && !mvs.length" class="hint">加载中…</div>
          <div v-else-if="!mvs.length" class="hint">该歌手暂无 MV</div>
          <template v-else>
            <div class="mv-grid">
              <button
                v-for="m in mvs"
                :key="`${m.source}_${m.vid}`"
                class="mv-card"
                @click="openMv(m)"
              >
                <div class="mv-thumb">
                  <img v-if="m.cover" :src="coverUrl(m.cover)" loading="lazy" alt="" />
                  <div v-else class="placeholder"><AppIcon name="video" :size="26" /></div>
                  <span v-if="m.duration" class="mv-dur">{{ fmtDuration(m.duration) }}</span>
                  <span class="mv-play"><AppIcon name="play" :size="18" /></span>
                </div>
                <span class="mv-name ellipsis-2">{{ m.title }}</span>
                <span v-if="m.playCount" class="album-sub"
                  >{{ formatFans(m.playCount) }} 次播放</span
                >
              </button>
            </div>
            <div v-if="mvsLoading" class="hint">加载中…</div>
            <div v-else-if="!mvsHasMore" class="hint">没有更多了</div>
          </template>
        </template>
      </template>
    </div>

    <!-- 多选操作栏（对应 Android SelectionBottomBar） -->
    <div v-if="selectionMode" class="sel-bar">
      <span class="sel-count">已选 {{ selection.length }} 首</span>
      <button class="sel-btn" @click="selectAll">
        {{ selection.length === songs.length ? '取消全选' : '全选' }}
      </button>
      <span class="sel-spacer" />
      <button class="sel-btn" @click="playSelectedNext">
        <AppIcon name="skip-forward" :size="14" /><span>下一首播放</span>
      </button>
      <button class="sel-btn" @click="addDialog = true">
        <AppIcon name="add-to" :size="13" /><span>添加到列表</span>
      </button>
      <button class="sel-btn" @click="qualityDialog = true">
        <AppIcon name="download" :size="14" /><span>下载</span>
      </button>
      <button class="sel-btn close" title="退出多选" @click="exitSelection">
        <AppIcon name="close" :size="14" />
      </button>
    </div>

    <ListAddDialog
      v-if="addDialog"
      :items="selection"
      @close="addDialog = false"
      @added="exitSelection"
    />
    <QualityDialog
      v-if="qualityDialog"
      :items="selection"
      @close="qualityDialog = false"
      @added="exitSelection"
    />
  </div>
</template>

<style scoped>
.artist-view {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.body {
  flex: 1;
  min-height: 0;
  padding: 20px 25px;
}

/* ---------- 头部 ---------- */
.ar-header {
  display: flex;
  gap: 20px;
  padding: 0 0 18px;
}
.ar-avatar {
  flex: none;
  width: 150px;
  height: 150px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  overflow: hidden;
  color: var(--color-font-label);
  background: var(--color-primary-background);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16);
}
.ar-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.ar-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
}
.ar-name {
  font-size: 24px;
  font-weight: 700;
  color: var(--color-font);
}
.ar-meta {
  margin-top: 8px;
  font-size: 13px;
  color: var(--color-font);
}
.ar-fans {
  margin-top: 4px;
  font-size: 12px;
  color: var(--color-font-label);
}
.ar-actions {
  margin-top: 18px;
}
.play-all {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 9px 20px;
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
.play-all:hover:not(:disabled) {
  background: var(--color-primary-dark-100);
}
.play-all:active:not(:disabled) {
  transform: scale(0.97);
}
.play-all:disabled {
  opacity: 0.5;
}

/* ---------- 简介 ---------- */
.ar-desc {
  position: relative;
  margin-bottom: 6px;
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--color-font-label);
}
.ar-desc p {
  margin: 0;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  overflow: hidden;
  white-space: pre-wrap;
}
.ar-desc.expanded p {
  -webkit-line-clamp: unset;
}
.ar-desc-toggle {
  margin-top: 2px;
  font-size: 12px;
  color: var(--color-primary);
}

.ar-tabs {
  margin: 4px 0 10px;
  padding-left: 0;
  border-bottom: var(--color-list-header-border-bottom);
}

.state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 30px 0;
  font-size: 13px;
  color: var(--color-font-label);
}
.retry {
  padding: 5px 16px;
  border-radius: 14px;
  font-size: 12.5px;
  color: var(--color-button-font);
  background: var(--color-button-background);
}
.retry:hover {
  background: var(--color-button-background-hover);
}

.list {
  display: flex;
  flex-direction: column;
}

/* ---------- 专辑 ---------- */
.ar-toolbar {
  display: flex;
  justify-content: flex-end;
  padding: 0 0 8px;
}
.icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 6px 8px;
  border-radius: var(--form-radius);
  color: var(--color-button-font);
  transition: background-color 0.2s ease;
}
.icon-btn:hover {
  background: var(--color-button-background-hover);
}

.album-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
  gap: 16px 14px;
}
.album-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  text-align: left;
  min-width: 0;
}
.album-cover {
  width: 100%;
  aspect-ratio: 1;
  border-radius: 8px;
  object-fit: cover;
  background: var(--color-primary-background);
  transition: transform 0.2s ease;
}
.album-card:hover .album-cover {
  transform: translateY(-3px);
}
.album-cover.placeholder,
.ar-cover.placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-font-label);
}
.album-name {
  font-size: 13px;
  color: var(--color-font);
}
.album-sub {
  font-size: 11.5px;
  color: var(--color-font-label);
}

.album-rows {
  display: flex;
  flex-direction: column;
}
.album-row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 7px 8px;
  border-radius: var(--radius-border);
  text-align: left;
  transition: background-color 0.15s ease;
}
.album-row:hover {
  background: var(--color-primary-background-hover);
}
.ar-cover.sm {
  flex: none;
  width: 52px;
  height: 52px;
  border-radius: 6px;
  object-fit: cover;
  background: var(--color-primary-background);
}
.album-row-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

/* ---------- MV ---------- */
.mv-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
  gap: 16px 14px;
}
.mv-card {
  display: flex;
  flex-direction: column;
  gap: 5px;
  text-align: left;
  min-width: 0;
}
.mv-thumb {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
  border-radius: 8px;
  overflow: hidden;
  background: var(--color-primary-background);
}
.mv-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.mv-thumb .placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--color-font-label);
}
.mv-dur {
  position: absolute;
  right: 5px;
  bottom: 5px;
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 11px;
  color: #fff;
  background: rgba(0, 0, 0, 0.6);
}
.mv-play {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  background: rgba(0, 0, 0, 0.28);
  opacity: 0;
  transition: opacity 0.2s ease;
}
.mv-card:hover .mv-play {
  opacity: 1;
}
.mv-name {
  font-size: 13px;
  color: var(--color-font);
}

/* ---------- 多选栏 ---------- */
.sel-bar {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 20px;
  border-top: var(--color-list-header-border-bottom);
  background: var(--color-primary-background);
}
.sel-count {
  font-size: 12.5px;
  color: var(--color-font);
}
.sel-spacer {
  flex: 1;
}
.sel-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 6px 12px;
  border-radius: 14px;
  font-size: 12.5px;
  color: var(--color-button-font);
  background: var(--color-button-background);
  transition: background-color 0.2s ease;
}
.sel-btn:hover {
  background: var(--color-button-background-hover);
}
.sel-btn.close {
  padding: 6px 8px;
}
</style>
