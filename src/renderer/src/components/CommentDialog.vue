<script setup lang="ts">
/**
 * 歌曲评论弹窗：热门 / 最新两个 Tab + 分页（LX MusicComment 的桌面弹窗版）。
 *
 * 抓取全部走主进程 Provider（渲染层不触网）。翻页时保留旧列表、只压低透明度，
 * 避免每次翻页整块闪空。Esc 关闭；曲目在弹窗打开期间被切换时自动重新拉取。
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import type { CommentItem, MusicItem } from '@common'
import AppIcon from './AppIcon.vue'
import CommentFloor from './CommentFloor.vue'
import { useApi } from '../composables/useApi'

const props = defineProps<{ track: MusicItem | null }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const api = useApi()
const LIMIT = 20

type TabId = 'hot' | 'new'
const tab = ref<TabId>('hot')

interface TabState {
  loading: boolean
  error: boolean
  page: number
  total: number
  maxPage: number
  list: CommentItem[]
}
function emptyState(): TabState {
  return { loading: false, error: false, page: 1, total: 0, maxPage: 1, list: [] }
}
const hot = ref<TabState>(emptyState())
const latest = ref<TabState>(emptyState())
const active = computed(() => (tab.value === 'hot' ? hot.value : latest.value))

/** 音源是否支持评论；本地文件与未接入的音源（qqc/joox）显示占位 */
const supported = ref(true)
const scroller = ref<HTMLElement | null>(null)

async function load(which: TabId, page: number): Promise<void> {
  const item = props.track
  if (!item || !supported.value) return
  const state = which === 'hot' ? hot : latest
  state.value.loading = true
  state.value.error = false
  try {
    const res =
      which === 'hot'
        ? await api.comment.hot(item, page, LIMIT)
        : await api.comment.latest(item, page, LIMIT)
    state.value.list = res.comments
    state.value.total = res.total
    state.value.maxPage = res.maxPage
    state.value.page = page
    if (which === tab.value) scroller.value?.scrollTo(0, 0)
  } catch {
    state.value.error = true
  } finally {
    state.value.loading = false
  }
}

async function refresh(): Promise<void> {
  const item = props.track
  hot.value = emptyState()
  latest.value = emptyState()
  if (!item || item.type === 'local') {
    supported.value = false
    return
  }
  supported.value = await api.comment.supported(item.type)
  if (!supported.value) return
  void load('hot', 1)
  void load('new', 1)
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') emit('close')
}

onMounted(() => {
  void refresh()
  window.addEventListener('keydown', onKeydown)
})
onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
})
watch(() => props.track, refresh)

function switchTab(id: TabId): void {
  if (tab.value === id) return
  tab.value = id
  scroller.value?.scrollTo(0, 0)
}

/** 分页按钮：当前页居中的最多 5 个页码 */
const pages = computed<number[]>(() => {
  const { page, maxPage } = active.value
  if (maxPage <= 1) return []
  const start = Math.max(1, Math.min(page - 2, maxPage - 4))
  const end = Math.min(maxPage, start + 4)
  const out: number[] = []
  for (let i = start; i <= end; i++) out.push(i)
  return out
})
function goPage(page: number): void {
  if (page === active.value.page) return
  void load(tab.value, page)
}
</script>

<template>
  <div class="mask" @click.self="emit('close')">
    <div class="dialog">
      <div class="head">
        <div class="title ellipsis">
          <span class="name">{{ track?.title || '评论' }}</span>
          <span v-if="track?.artist" class="artist">{{ track.artist }}</span>
        </div>
        <button class="hbtn" title="刷新" @click="refresh">
          <AppIcon name="refresh" :size="16" />
        </button>
        <button class="hbtn" title="关闭" @click="emit('close')">
          <AppIcon name="close" :size="16" />
        </button>
      </div>

      <template v-if="supported">
        <div class="tabs">
          <button class="tab" :class="{ active: tab === 'hot' }" @click="switchTab('hot')">
            热门 ({{ hot.total }})
          </button>
          <button class="tab" :class="{ active: tab === 'new' }" @click="switchTab('new')">
            最新 ({{ latest.total }})
          </button>
        </div>

        <div ref="scroller" class="scroll">
          <button v-if="active.error" class="hint clickable" @click="load(tab, active.page)">
            加载失败，点击重试
          </button>
          <div v-else-if="active.loading && !active.list.length" class="hint">加载中…</div>
          <CommentFloor
            v-else-if="active.list.length"
            :class="{ dim: active.loading }"
            :comments="active.list"
          />
          <div v-else class="hint">暂无评论</div>
        </div>

        <div v-if="pages.length" class="pager">
          <button
            v-for="p in pages"
            :key="p"
            class="pbtn"
            :class="{ active: p === active.page }"
            @click="goPage(p)"
          >
            {{ p }}
          </button>
          <span class="pinfo">共 {{ active.maxPage }} 页</span>
        </div>
      </template>
      <div v-else class="hint center">该音源暂不支持评论</div>
    </div>
  </div>
</template>

<style scoped>
.mask {
  position: fixed;
  inset: 0;
  z-index: 2100;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.35);
  /* 播放页整块底板是窗口拖拽区，本弹窗渲染在其内部会继承 drag 而点不动 */
  -webkit-app-region: no-drag;
}
.dialog {
  display: flex;
  flex-direction: column;
  width: 720px;
  max-width: 90vw;
  height: 640px;
  max-height: 82vh;
  padding: 15px;
  border-radius: 8px;
  background: var(--color-content-background);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.28);
}
.head {
  flex: none;
  display: flex;
  align-items: center;
  gap: 6px;
}
.title {
  flex: auto;
  min-width: 0;
  font-size: 13px;
  color: var(--color-font);
}
.name {
  font-weight: 600;
}
.artist {
  margin-left: 8px;
  color: var(--color-font-label);
}
.hbtn {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  color: var(--color-primary);
  transition: background-color 0.2s ease;
}
.hbtn:hover {
  background: var(--color-button-background-hover);
}
.tabs {
  flex: none;
  display: flex;
  gap: 6px;
  margin-top: 10px;
}
.tab {
  padding: 5px 12px;
  border-radius: 999px;
  font-size: 13px;
  color: var(--color-font-label);
  transition:
    background-color 0.2s ease,
    color 0.2s ease;
}
.tab:hover {
  color: var(--color-font);
  background: var(--color-button-background-hover);
}
.tab.active {
  color: var(--color-button-font-selected);
  background: var(--color-button-background-selected);
}
.scroll {
  flex: auto;
  min-height: 0;
  margin-top: 8px;
  padding: 0 10px;
  overflow-y: auto;
  border-radius: 4px;
  background: var(--color-primary-light-400-alpha-700);
  scroll-behavior: smooth;
}
/* 翻页中：保留旧内容压暗，避免整块闪空 */
.dim {
  opacity: 0.4;
}
.hint {
  padding: 16px 6px;
  font-size: 13px;
  color: var(--color-font-label);
}
.hint.center {
  flex: auto;
  padding-top: 15%;
  text-align: center;
}
.hint.clickable {
  display: block;
  width: 100%;
  text-align: left;
  cursor: pointer;
}
.pager {
  flex: none;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 12px;
}
.pbtn {
  min-width: 28px;
  height: 28px;
  padding: 0 6px;
  border-radius: var(--form-radius);
  font-size: 12px;
  color: var(--color-button-font);
  background: var(--color-button-background);
  transition: background-color 0.2s ease;
}
.pbtn:hover {
  background: var(--color-button-background-hover);
}
.pbtn.active {
  color: var(--color-button-font-selected);
  background: var(--color-button-background-selected);
}
.pinfo {
  margin-left: 4px;
  font-size: 12px;
  color: var(--color-font-label);
}
.ellipsis {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
