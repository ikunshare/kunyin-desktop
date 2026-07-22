import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { MusicItem, MusicSource } from '@common'

const HISTORY_KEY = 'kunyin:searchHistory'
const HISTORY_MAX = 20

function loadHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    return raw ? (JSON.parse(raw) as string[]) : []
  } catch {
    return []
  }
}

export const useSearchStore = defineStore('search', () => {
  const source = ref<MusicSource>('wy')
  const keyword = ref('')
  const results = ref<MusicItem[]>([])
  const loading = ref(false)
  const page = ref(0)
  const hasNext = ref(false)
  /** 当前音源热搜词（无检索时展示，仿 LX） */
  const hotWords = ref<string[]>([])
  const hotLoading = ref(false)
  /** 搜索历史（本地持久化，最近在前） */
  const history = ref<string[]>(loadHistory())

  function persistHistory(): void {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history.value))
    } catch {
      /* localStorage 不可用则忽略 */
    }
  }
  function addHistory(kw: string): void {
    const q = kw.trim()
    if (!q) return
    history.value = [q, ...history.value.filter((h) => h !== q)].slice(0, HISTORY_MAX)
    persistHistory()
  }
  function removeHistory(kw: string): void {
    history.value = history.value.filter((h) => h !== kw)
    persistHistory()
  }
  function clearHistory(): void {
    history.value = []
    persistHistory()
  }

  async function search(reset = true): Promise<void> {
    if (!keyword.value.trim()) return
    if (reset) addHistory(keyword.value)
    loading.value = true
    if (reset) {
      page.value = 0
      results.value = []
    }
    try {
      const res = await window.api.search.songs(source.value, keyword.value, page.value, 20)
      results.value = reset ? res.result : [...results.value, ...res.result]
      hasNext.value = res.hasNext
    } finally {
      loading.value = false
    }
  }

  /** 搜索建议词（输入时下拉） */
  async function tips(kw: string): Promise<string[]> {
    if (!kw.trim()) return []
    try {
      return await window.api.search.tip(source.value, kw)
    } catch {
      return []
    }
  }

  /** 加载当前音源热搜词 */
  async function loadHot(): Promise<void> {
    hotLoading.value = true
    try {
      hotWords.value = await window.api.search.hot(source.value)
    } catch {
      hotWords.value = []
    } finally {
      hotLoading.value = false
    }
  }

  /** 用指定关键词检索（点击热搜词 / 外部触发） */
  async function searchFor(kw: string): Promise<void> {
    keyword.value = kw
    await search()
  }

  return {
    source,
    keyword,
    results,
    loading,
    page,
    hasNext,
    hotWords,
    hotLoading,
    history,
    search,
    loadHot,
    searchFor,
    tips,
    addHistory,
    removeHistory,
    clearHistory
  }
})
