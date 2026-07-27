import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { AlbumInfoResult, ArtistInfoResult, MusicItem, MusicSource } from '@common'

/** 搜索类型（对应 Android SearchType；joox 等只支持单曲，UI 按平台隐藏其余 Tab） */
export type SearchType = 'song' | 'album' | 'artist'

export const SEARCH_TYPES: readonly { id: SearchType; label: string }[] = [
  { id: 'song', label: '单曲' },
  { id: 'album', label: '专辑' },
  { id: 'artist', label: '歌手' }
] as const

/** 各平台支持的搜索类型（joox/sp 只有单曲，与 Android supportedSearchTypes 一致） */
export function supportedSearchTypes(source: MusicSource): SearchType[] {
  return source === 'joox' || source === 'sp' ? ['song'] : ['song', 'album', 'artist']
}

const HISTORY_KEY = 'kunyin:searchHistory'
const HISTORY_MAX = 20
const PAGE_SIZE = 20

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
  const searchType = ref<SearchType>('song')
  const results = ref<MusicItem[]>([])
  const albumResults = ref<AlbumInfoResult[]>([])
  const artistResults = ref<ArtistInfoResult[]>([])
  const loading = ref(false)
  const loadingMore = ref(false)
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

  function clearResults(): void {
    results.value = []
    albumResults.value = []
    artistResults.value = []
    page.value = 0
    hasNext.value = false
  }

  async function search(reset = true): Promise<void> {
    if (!keyword.value.trim()) return
    if (reset) addHistory(keyword.value)
    if (reset) {
      page.value = 0
      clearResults()
      loading.value = true
    } else {
      loadingMore.value = true
    }
    try {
      switch (searchType.value) {
        case 'album': {
          const res = await window.api.discover.searchAlbum(
            source.value,
            keyword.value,
            page.value,
            PAGE_SIZE
          )
          albumResults.value = reset ? res.result : [...albumResults.value, ...res.result]
          hasNext.value = res.hasNext
          break
        }
        case 'artist': {
          const res = await window.api.discover.searchArtist(
            source.value,
            keyword.value,
            page.value,
            PAGE_SIZE
          )
          artistResults.value = reset ? res.result : [...artistResults.value, ...res.result]
          hasNext.value = res.hasNext
          break
        }
        default: {
          const res = await window.api.search.songs(
            source.value,
            keyword.value,
            page.value,
            PAGE_SIZE
          )
          results.value = reset ? res.result : [...results.value, ...res.result]
          hasNext.value = res.hasNext
        }
      }
    } finally {
      loading.value = false
      loadingMore.value = false
    }
  }

  /** 下一页（追加） */
  async function loadMore(): Promise<void> {
    if (loading.value || loadingMore.value || !hasNext.value) return
    page.value += 1
    await search(false)
  }

  /** 切换搜索类型：清空结果并按现关键词重搜（对应 Android switchSearchType） */
  async function switchType(type: SearchType): Promise<void> {
    if (searchType.value === type) return
    searchType.value = type
    clearResults()
    if (keyword.value.trim()) await search()
  }

  /** 切平台时回退到该平台支持的类型（joox 只有单曲） */
  function ensureTypeSupported(): void {
    if (!supportedSearchTypes(source.value).includes(searchType.value)) {
      searchType.value = 'song'
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
    searchType,
    results,
    albumResults,
    artistResults,
    loading,
    loadingMore,
    page,
    hasNext,
    hotWords,
    hotLoading,
    history,
    search,
    loadMore,
    switchType,
    ensureTypeSupported,
    loadHot,
    searchFor,
    tips,
    addHistory,
    removeHistory,
    clearHistory
  }
})
