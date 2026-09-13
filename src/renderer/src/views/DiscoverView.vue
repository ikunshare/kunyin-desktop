<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import {
  DISCOVER_SOURCES,
  PLATFORM_NAMES,
  PLAYLIST_CATEGORY_SORTABLE,
  PLAYLIST_SORTS,
  type MusicSource,
  type PlaylistCategory,
  type PlayListInfoResult
} from '@common'
import PlaylistCards from '../components/PlaylistCards.vue'
import AppTabs from '../components/AppTabs.vue'
import BaseSelect from '../components/BaseSelect.vue'
import BaseBtn from '../components/BaseBtn.vue'
import BasePagination from '../components/BasePagination.vue'
import { useApi } from '../composables/useApi'

/**
 * 热门歌单（对齐 LX views/songList/List）：
 * 顶部左侧「分类 + 排序 Tab」、右侧「平台」；下方卡片网格 + 分页。
 * 平台/分类/排序/页码记忆到本地，回到页面时保持原位；分类与列表结果由主进程缓存。
 */
defineOptions({ name: 'DiscoverView' })

const api = useApi()
const SAVE_KEY = 'kunyin:discover:state'

const sourceOptions = DISCOVER_SOURCES.map((id) => ({ id, label: PLATFORM_NAMES[id] }))

const source = ref<MusicSource>('wy')
const category = ref('')
const order = ref('')
const page = ref(0)

const sorts = computed(() => PLAYLIST_SORTS[source.value] ?? [])
const sortTabs = computed(() => sorts.value.map((s) => ({ id: s.id, label: s.name })))
/** 选了分类后排序是否仍有效（QQ / 酷我分类接口无排序参数，置灰） */
const sortDisabled = computed(
  () => !!category.value && !(PLAYLIST_CATEGORY_SORTABLE[source.value] ?? false)
)

// ============ 分类 ============
const categories = ref<PlaylistCategory[]>([])
const categoryError = ref('')
const groups = computed(() => [...new Set(categories.value.map((item) => item.group))])
const categoryName = computed(
  () => categories.value.find((c) => c.id === category.value)?.name ?? ''
)

let categoryToken = 0
async function loadCategories(): Promise<void> {
  const token = ++categoryToken
  const src = source.value
  categoryError.value = ''
  try {
    const list = await api.discover.categories(src)
    if (token !== categoryToken) return
    categories.value = list
    // 记忆的分类已不存在（平台改版）则回到「全部」
    if (category.value && !list.some((c) => c.id === category.value)) {
      category.value = ''
    }
  } catch (e) {
    if (token === categoryToken) {
      categories.value = []
      categoryError.value = e instanceof Error ? e.message : '分类加载失败'
    }
  }
}

// ============ 列表 ============
const items = ref<PlayListInfoResult[]>([])
const loading = ref(false)
const error = ref('')
const total = ref(0)
const pageSize = ref(30)
const hasNext = ref(false)
const gridEl = ref<HTMLElement | null>(null)

const pageCount = computed(() => {
  if (total.value > 0 && pageSize.value > 0)
    return Math.max(1, Math.ceil(total.value / pageSize.value))
  return hasNext.value ? page.value + 2 : page.value + 1
})
const showPagination = computed(
  () => !loading.value && !error.value && items.value.length > 0 && pageCount.value > 1
)

const query = computed(() => `${source.value}|${category.value}|${order.value}|${page.value}`)

let loadToken = 0
async function load(): Promise<void> {
  const token = ++loadToken
  loading.value = true
  error.value = ''
  try {
    const result = await api.discover.playlists(
      source.value,
      category.value,
      order.value,
      page.value,
      30
    )
    if (token !== loadToken) return
    // 酷狗推荐位与分页首条可能重复，按平台+id 去重
    items.value = [...new Map(result.result.map((it) => [`${it.source}:${it.id}`, it])).values()]
    total.value = result.total ?? 0
    pageSize.value = result.size || 30
    hasNext.value = result.hasNext && result.result.length > 0
    await nextTick()
    gridEl.value?.scrollTo({ top: 0 })
  } catch (e) {
    if (token === loadToken) {
      items.value = []
      error.value = e instanceof Error ? e.message : '加载失败，请重试'
    }
  } finally {
    if (token === loadToken) loading.value = false
  }
}

// ============ 交互 ============
function switchSource(id: string): void {
  if (id === source.value) return
  source.value = id as MusicSource
  category.value = ''
  order.value = PLAYLIST_SORTS[source.value]?.[0]?.id ?? ''
  page.value = 0
}
function switchCategory(id: string): void {
  if (id === category.value) return
  category.value = id
  page.value = 0
}
function switchOrder(id: string): void {
  if (id === order.value) return
  order.value = id
  page.value = 0
}
function togglePage(p: number): void {
  page.value = p
}

// ============ 状态记忆 ============
function restore(): void {
  try {
    const saved = JSON.parse(localStorage.getItem(SAVE_KEY) ?? 'null') as {
      source?: MusicSource
      category?: string
      order?: string
      page?: number
    } | null
    if (saved?.source && DISCOVER_SOURCES.includes(saved.source)) {
      source.value = saved.source
      category.value = saved.category ?? ''
      order.value = saved.order ?? ''
      page.value = Math.max(0, Number(saved.page) || 0)
    }
  } catch {
    /* ignore */
  }
  if (!sorts.value.some((s) => s.id === order.value)) order.value = sorts.value[0]?.id ?? ''
}
function persist(): void {
  try {
    localStorage.setItem(
      SAVE_KEY,
      JSON.stringify({
        source: source.value,
        category: category.value,
        order: order.value,
        page: page.value
      })
    )
  } catch {
    /* ignore */
  }
}

// 先恢复记忆的筛选条件，再由 immediate watch 触发首轮加载
restore()
watch(source, () => void loadCategories(), { immediate: true })
watch(
  query,
  () => {
    persist()
    void load()
  },
  { immediate: true }
)
</script>

<template>
  <div class="discover">
    <div class="header">
      <div class="left">
        <BaseSelect
          class="cat-select"
          :model-value="category"
          :title="categoryName ? `分类：${categoryName}` : '选择歌单分类'"
          @update:model-value="switchCategory"
        >
          <option value="">默认</option>
          <optgroup v-for="group in groups" :key="group" :label="group">
            <option
              v-for="item in categories.filter((c) => c.group === group)"
              :key="item.id"
              :value="item.id"
            >
              {{ item.name }}
            </option>
          </optgroup>
        </BaseSelect>
        <AppTabs
          v-if="sortTabs.length > 1"
          class="sort-tabs"
          :class="{ disabled: sortDisabled }"
          :model-value="order"
          :list="sortTabs"
          @change="switchOrder"
        />
      </div>
      <BaseSelect
        class="src-select"
        :model-value="source"
        :list="sourceOptions"
        title="切换平台"
        @update:model-value="switchSource"
      />
    </div>

    <div ref="gridEl" class="body scroll">
      <div v-if="categoryError && !categories.length" class="state minor">
        {{ categoryError }}
        <BaseBtn min outline @click="loadCategories">重试</BaseBtn>
      </div>
      <div v-if="error" class="state" role="alert">
        {{ error }} <BaseBtn min outline @click="load">重试</BaseBtn>
      </div>
      <div v-else-if="loading" class="state">加载中…</div>
      <div v-else-if="!items.length" class="state">暂无内容，请切换平台或分类</div>
      <template v-else>
        <PlaylistCards :items="items" />
        <BasePagination
          v-if="showPagination"
          :page="page"
          :page-count="pageCount"
          :disabled="loading"
          @change="togglePage"
        />
      </template>
    </div>
  </div>
</template>

<style scoped>
.discover {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.header {
  flex: none;
  display: flex;
  align-items: center;
  gap: 12px;
  height: 38px;
  padding: 0 16px 0 8px;
  border-bottom: var(--color-list-header-border-bottom);
}
.left {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 4px;
}
.header .cat-select {
  flex: none;
  min-width: 120px;
  max-width: 200px;
  height: 28px;
  padding: 0 26px 0 8px;
  border-color: transparent;
  background-color: transparent;
}
.header .src-select {
  flex: none;
  min-width: 120px;
  height: 28px;
  padding: 0 26px 0 8px;
  border-color: transparent;
  background-color: transparent;
}
.left .sort-tabs {
  padding: 0 8px;
  gap: 18px;
  transition: opacity 0.2s ease;
}
.left .sort-tabs.disabled {
  opacity: 0.35;
  pointer-events: none;
}
.body {
  flex: 1;
  min-height: 0;
  padding: 15px 16px 0;
}
.state {
  padding: 40px 0;
  text-align: center;
  font-size: 13px;
  color: var(--color-font-label);
}
.state.minor {
  padding: 8px 0 0;
  font-size: 12px;
}
</style>
