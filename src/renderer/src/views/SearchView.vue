<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useRouter } from 'vue-router'
import { useSearchStore, supportedSearchTypes, SEARCH_TYPES } from '../stores/search'
import { usePlayerStore } from '../stores/player'
import { useArtistStore } from '../stores/artist'
import { useSongSelection } from '../composables/useSongSelection'
import {
  PLATFORMS,
  PLATFORM_NAMES,
  getMusicItemKey,
  type ArtistInfoResult,
  type MusicSource
} from '@common'
import PlaylistCards from '../components/PlaylistCards.vue'
import BaseBtn from '../components/BaseBtn.vue'
import SongRow from '../components/SongRow.vue'
import AppTabs from '../components/AppTabs.vue'
import AppIcon from '../components/AppIcon.vue'
import ListAddDialog from '../components/ListAddDialog.vue'
import QualityDialog from '../components/QualityDialog.vue'
import { coverUrl } from '../utils/cover'

defineOptions({ name: 'SearchView' })

const router = useRouter()
const searchStore = useSearchStore()
const player = usePlayerStore()
const artistStore = useArtistStore()
const {
  source,
  keyword,
  searchType,
  results,
  albumResults,
  artistResults,
  playlistResults,
  error,
  loading,
  loadingMore,
  hasNext,
  hotWords,
  history
} = storeToRefs(searchStore)

const sourceTabs = PLATFORMS.map((p) => ({ id: p, label: PLATFORM_NAMES[p] }))

// 搜索类型 Tab（对应 Android SearchScreen 的类型 chips；joox 只支持单曲时整排隐藏）
const typeTabs = computed(() =>
  SEARCH_TYPES.filter((t) => supportedSearchTypes(source.value).includes(t.id))
)
const showTypeTabs = computed(() => typeTabs.value.length > 1)

function switchSource(id: string): void {
  source.value = id as MusicSource
  searchStore.ensureTypeSupported()
  if (keyword.value) void searchStore.search()
  else void searchStore.loadHot()
}

function isActive(item: (typeof results.value)[number]): boolean {
  return !!player.current && getMusicItemKey(player.current) === getMusicItemKey(item)
}

function openAlbum(id: string): void {
  void router.push({ name: 'album', params: { albumKey: `${source.value}:${id}` } })
}
/** 先缓存搜索结果里的歌手信息，详情页进入即可渲染头像/名称，不必空等接口 */
function openArtist(a: ArtistInfoResult): void {
  artistStore.cachePreview(a)
  void router.push({ name: 'artist', params: { artistKey: `${source.value}:${a.id}` } })
}

const showBlank = computed(
  () =>
    !loading.value &&
    !keyword.value &&
    !results.value.length &&
    !albumResults.value.length &&
    !artistResults.value.length
)

// ============ 单曲结果多选批量操作（与「我的列表」/ 排行榜一致） ============
const { selectedCount, selectedItems, isSelected, clearSelection, onRowSelect } =
  useSongSelection(results)
/** 批量「播放」：所选歌曲组成临时队列，首曲记入试听列表（同专辑/歌手页点单曲） */
function playSelected(): void {
  const items = selectedItems.value
  if (!items.length) return
  player.playItem(items[0], items, {
    trackTrial: true,
    source: { kind: 'search', name: `搜索「${keyword.value}」` }
  })
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
// 新一轮检索（loading 只在重置搜索时为真）/ 结果被清空 / 切换类型：已选失效
watch(loading, (v) => {
  if (v) clearSelection()
})
watch(
  () => results.value.length,
  (n) => {
    if (!n) clearSelection()
  }
)
watch(searchType, clearSelection)

// ============ 轻提示 ============
const toast = ref('')
let toastTimer: ReturnType<typeof setTimeout> | null = null
function showToast(msg: string): void {
  toast.value = msg
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = ''), 3600)
}

onMounted(() => {
  if (!results.value.length && !keyword.value) void searchStore.loadHot()
})

// 音源热搜词随 tab 切换刷新（无检索时）
watch(source, () => {
  if (!keyword.value) void searchStore.loadHot()
})
</script>

<template>
  <div class="search-view">
    <div class="header">
      <AppTabs :model-value="source" :list="sourceTabs" @change="switchSource" />
      <AppTabs
        v-if="showTypeTabs"
        class="type-tabs"
        :model-value="searchType"
        :list="typeTabs"
        @change="(id) => void searchStore.switchType(id as typeof searchType)"
      />
    </div>
    <div class="body scroll">
      <div v-if="loading" class="hint">搜索中…</div>

      <!-- 单曲结果 -->
      <template v-else-if="searchType === 'song'">
        <div v-if="results.length" class="list">
          <!-- 试听模型：该曲进试听列表，队列 = 整个试听列表（不变成搜索结果，也不单曲循环） -->
          <SongRow
            v-for="(item, i) in results"
            :key="getMusicItemKey(item)"
            :item="item"
            :index="i"
            :active="isActive(item)"
            :selected="isSelected(item)"
            @play="player.playInTrial(item)"
            @select="onRowSelect($event, i)"
          />
        </div>
        <div v-else-if="keyword" class="empty">未找到「{{ keyword }}」相关歌曲</div>
      </template>

      <!-- 专辑结果（Android AlbumSearchResultsList：圆角封面 + 名称 + 歌手 · N首） -->
      <template v-else-if="searchType === 'album'">
        <div v-if="albumResults.length" class="card-list">
          <button v-for="a in albumResults" :key="a.id" class="card-row" @click="openAlbum(a.id)">
            <img v-if="a.cover" class="cover" :src="coverUrl(a.cover)" loading="lazy" alt="" />
            <div v-else class="cover placeholder"><AppIcon name="library" :size="22" /></div>
            <div class="meta">
              <span class="name ellipsis">{{ a.name }}</span>
              <span class="sub ellipsis">
                {{
                  [a.artist, a.total ? `${a.total} 首` : '', a.publishTime]
                    .filter(Boolean)
                    .join(' · ')
                }}
              </span>
            </div>
          </button>
        </div>
        <div v-else-if="keyword" class="empty">未找到「{{ keyword }}」相关专辑</div>
      </template>

      <template v-else-if="searchType === 'playlist'">
        <PlaylistCards :items="playlistResults" />
        <div v-if="keyword && !playlistResults.length && !error" class="empty">未找到相关歌单</div>
      </template>

      <!-- 歌手结果（Android ArtistSearchResultsList：圆形头像 + 名称 + N张专辑 · M首） -->
      <template v-else>
        <div v-if="artistResults.length" class="card-list">
          <button v-for="a in artistResults" :key="a.id" class="card-row" @click="openArtist(a)">
            <img
              v-if="a.cover"
              class="cover round"
              :src="coverUrl(a.cover)"
              loading="lazy"
              alt=""
            />
            <div v-else class="cover round placeholder"><AppIcon name="library" :size="22" /></div>
            <div class="meta">
              <span class="name ellipsis">{{ a.name }}</span>
              <span class="sub ellipsis">
                {{
                  [
                    a.albumCount ? `${a.albumCount} 张专辑` : '',
                    a.songCount ? `${a.songCount} 首` : ''
                  ]
                    .filter(Boolean)
                    .join(' · ')
                }}
              </span>
            </div>
          </button>
        </div>
        <div v-else-if="keyword" class="empty">未找到「{{ keyword }}」相关歌手</div>
      </template>

      <div v-if="error" class="hint" role="alert">
        {{ error }} <BaseBtn min @click="searchStore.search()">重试</BaseBtn>
      </div>

      <!-- 加载更多（Android 无限滚动的按钮版） -->
      <div v-if="!loading && hasNext && keyword" class="more">
        <button class="more-btn" :disabled="loadingMore" @click="void searchStore.loadMore()">
          {{ loadingMore ? '加载中…' : '加载更多' }}
        </button>
      </div>

      <!-- LX BlankView：热门搜索 / 搜索历史 chip 流 -->
      <div v-if="showBlank" class="blank">
        <dl v-if="hotWords.length" class="group">
          <dt class="group-title">热门搜索</dt>
          <dd class="group-body">
            <button
              v-for="(w, i) in hotWords"
              :key="w + i"
              class="chip ellipsis"
              @click="searchStore.searchFor(w)"
            >
              {{ w }}
            </button>
          </dd>
        </dl>
        <dl v-if="history.length" class="group">
          <dt class="group-title">
            <span class="title">
              搜索历史
              <button class="clear" title="清空搜索历史" @click="searchStore.clearHistory()">
                <AppIcon name="trash" :size="15" />
              </button>
            </span>
          </dt>
          <dd class="group-body">
            <button
              v-for="h in history"
              :key="h"
              class="chip ellipsis"
              @click="searchStore.searchFor(h)"
            >
              {{ h }}
            </button>
          </dd>
        </dl>
      </div>
    </div>

    <!-- 批量操作栏（Ctrl / Shift 单击选中单曲结果后出现） -->
    <Transition name="batchbar">
      <div v-if="searchType === 'song' && selectedCount" class="batch-bar">
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

    <ListAddDialog
      v-if="addDialog"
      :items="selectedItems"
      @added="onAdded"
      @close="addDialog = false"
    />
    <QualityDialog
      v-if="qualityDialog"
      :items="selectedItems"
      :list-name="keyword"
      @added="onDownloadAdded"
      @close="qualityDialog = false"
    />

    <Transition name="toast">
      <div v-if="toast" class="toast">{{ toast }}</div>
    </Transition>
  </div>
</template>

<style scoped>
.search-view {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.header {
  flex: none;
  padding-top: 10px;
}
.type-tabs {
  margin-top: 2px;
  padding-bottom: 2px;
  border-bottom: var(--color-list-header-border-bottom);
}
.body {
  flex: 1;
  min-height: 0;
  padding: 10px 15px 20px;
}
.list {
  display: flex;
  flex-direction: column;
}
.hint,
.empty {
  padding: 15px 0;
  color: var(--color-font-label);
  font-size: 13px;
}

/* 专辑/歌手结果行（对应 Android 搜索结果的 56dp 封面行） */
.card-list {
  display: flex;
  flex-direction: column;
}
.card-row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 7px 8px;
  border-radius: var(--radius-border);
  text-align: left;
  transition: background-color 0.15s ease;
}
.card-row:hover {
  background-color: var(--color-primary-background-hover);
}
.cover {
  flex: none;
  width: 52px;
  height: 52px;
  border-radius: 8px;
  object-fit: cover;
  background: var(--color-primary-background);
}
.cover.round {
  border-radius: 50%;
}
.cover.placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-font-label);
}
.meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.name {
  font-size: 13.5px;
  color: var(--color-font);
}
.sub {
  font-size: 12px;
  color: var(--color-font-label);
}

.more {
  display: flex;
  justify-content: center;
  padding: 14px 0 4px;
}
.more-btn {
  padding: 7px 22px;
  border-radius: 16px;
  font-size: 13px;
  color: var(--color-button-font);
  background: var(--color-button-background);
  transition: background-color 0.2s ease;
}
.more-btn:hover {
  background: var(--color-button-background-hover);
}

/* LX 空白页：标题 + chip 流式布局 */
.blank {
  padding: 5px;
}
.group + .group {
  margin-top: 14px;
}
.group-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 5px 5px 8px;
  font-size: 14px;
  font-weight: 600;
  color: var(--color-font);
}
.title {
  display: flex;
  align-items: center;
  gap: 6px;
}
.clear {
  display: flex;
  color: var(--color-font-label);
  opacity: 0.45;
  transition: opacity 0.2s ease;
}
.clear:hover {
  opacity: 1;
  color: var(--color-font);
}
.group-body {
  margin: 0;
}
.chip {
  display: inline-block;
  max-width: 150px;
  margin: 3px 5px;
  padding: 7px 10px;
  border-radius: 5px;
  font-size: 13px;
  color: var(--color-button-font);
  background-color: var(--color-button-background);
  transition: background-color 0.2s ease;
  vertical-align: middle;
}
.chip:hover {
  background-color: var(--color-button-background-hover);
}
.chip:active {
  background-color: var(--color-button-background-active);
}

/* ---------- 批量操作栏（与「我的列表」同款） ---------- */
.batch-bar {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 15px 14px;
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
