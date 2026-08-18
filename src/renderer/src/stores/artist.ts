import { defineStore } from 'pinia'
import { ref } from 'vue'
import type {
  AlbumInfoResult,
  ArtistInfoResult,
  ArtistMvItem,
  MusicItem,
  MusicSource
} from '@common'

/** 对应 Android ArtistViewModel.ArtistTab */
export type ArtistTab = 'songs' | 'albums' | 'mvs'

const SONG_PAGE_SIZE = 30
const ALBUM_PAGE_SIZE = 30
const MV_PAGE_SIZE = 40

/**
 * 歌手页状态（移植 ArtistViewModel）。
 *
 * 三个 Tab 各自独立分页：歌曲随详情一同首屏加载，专辑/MV 首次切到该 Tab 时才拉
 * （对应 selectTab 的懒加载），避免进页面就打三个接口。
 */
export const useArtistStore = defineStore('artist', () => {
  /**
   * 详情页加载前的占位缓存（对应 Android ArtistPreviewCache）：搜索结果点击时 put 一份，
   * 进页面立刻有头像/名字可渲染，详情返回后再做字段级合并（fresh 非空优先）。
   */
  const preview = new Map<string, ArtistInfoResult>()

  const info = ref<ArtistInfoResult | null>(null)
  const loading = ref(false)
  const error = ref('')
  const tab = ref<ArtistTab>('songs')
  const showAlbumsTab = ref(false)
  const showMvsTab = ref(false)

  const songs = ref<MusicItem[]>([])
  const songsLoadingMore = ref(false)
  const songsHasMore = ref(true)
  const songsPage = ref(0)

  const albums = ref<AlbumInfoResult[]>([])
  const albumsLoaded = ref(false)
  const albumsLoading = ref(false)
  const albumsHasMore = ref(true)
  const albumsPage = ref(0)

  const mvs = ref<ArtistMvItem[]>([])
  const mvsLoaded = ref(false)
  const mvsLoading = ref(false)
  const mvsHasMore = ref(true)
  const mvsPage = ref(0)

  /** 页面滚动位置：点进专辑/MV 再返回时恢复到原处（换歌手时清零） */
  const scrollTop = ref(0)
  function setScroll(v: number): void {
    scrollTop.value = v
  }

  let currentKey = ''
  let source: MusicSource | '' = ''
  let artistId = ''

  function cachePreview(item: ArtistInfoResult): void {
    preview.set(`${item.source}:${item.id}`, item)
  }

  /** fresh 的空字段用缓存补齐（对应 ArtistPreviewCache.merge） */
  function merge(
    fresh: ArtistInfoResult | null,
    cached: ArtistInfoResult | undefined
  ): ArtistInfoResult | null {
    if (!fresh) return cached ?? null
    if (!cached) return fresh
    return {
      ...fresh,
      name: fresh.name || cached.name,
      cover: fresh.cover || cached.cover,
      description: fresh.description || cached.description,
      songCount: fresh.songCount || cached.songCount,
      albumCount: fresh.albumCount || cached.albumCount,
      fansCount: fresh.fansCount || cached.fansCount
    }
  }

  function reset(cached: ArtistInfoResult | undefined): void {
    info.value = cached ?? null
    loading.value = true
    error.value = ''
    tab.value = 'songs'
    scrollTop.value = 0
    songs.value = []
    songsLoadingMore.value = false
    songsHasMore.value = true
    songsPage.value = 0
    albums.value = []
    albumsLoaded.value = false
    albumsLoading.value = false
    albumsHasMore.value = true
    albumsPage.value = 0
    mvs.value = []
    mvsLoaded.value = false
    mvsLoading.value = false
    mvsHasMore.value = true
    mvsPage.value = 0
  }

  /** 加载歌手详情 + 首页热门歌曲。同一歌手且已有数据时跳过（对应 loadArtist 的短路）。 */
  async function load(src: MusicSource, id: string, force = false): Promise<void> {
    const key = `${src}:${id}`
    if (!force && key === currentKey && songs.value.length) return
    currentKey = key
    source = src
    artistId = id

    const cached = preview.get(key)
    reset(cached)

    const caps = await window.api.discover.artistCaps(src).catch(() => null)
    showAlbumsTab.value = caps?.albums ?? false
    showMvsTab.value = caps?.mvs ?? false

    try {
      const [fresh, songResult] = await Promise.all([
        window.api.discover.artistInfo(src, id),
        window.api.discover.artistSongs(src, id, 0, SONG_PAGE_SIZE)
      ])
      // 竞态保护：加载期间用户切到了别的歌手，丢弃本次结果
      if (currentKey !== key) return
      info.value = merge(fresh, cached)
      songs.value = songResult.result
      songsHasMore.value = songResult.hasNext
      songsPage.value = 0
      if (!info.value && !songResult.result.length) error.value = '未找到该歌手'
    } catch (e) {
      if (currentKey !== key) return
      error.value = e instanceof Error ? e.message : '加载歌手失败'
    } finally {
      if (currentKey === key) loading.value = false
    }
  }

  async function loadMoreSongs(): Promise<void> {
    if (songsLoadingMore.value || !songsHasMore.value || !source) return
    const key = currentKey
    const next = songsPage.value + 1
    songsLoadingMore.value = true
    try {
      const r = await window.api.discover.artistSongs(source, artistId, next, SONG_PAGE_SIZE)
      if (currentKey !== key) return
      songs.value = [...songs.value, ...r.result]
      songsHasMore.value = r.hasNext
      songsPage.value = next
    } catch {
      /* 加载更多失败不打断已有列表 */
    } finally {
      if (currentKey === key) songsLoadingMore.value = false
    }
  }

  async function loadMoreAlbums(): Promise<void> {
    if (albumsLoading.value || (albumsLoaded.value && !albumsHasMore.value) || !source) return
    const key = currentKey
    const next = albumsLoaded.value ? albumsPage.value + 1 : 0
    albumsLoading.value = true
    try {
      const r = await window.api.discover.artistAlbums(source, artistId, next, ALBUM_PAGE_SIZE)
      if (currentKey !== key) return
      albums.value = next === 0 ? r.result : [...albums.value, ...r.result]
      albumsHasMore.value = r.hasNext
      albumsPage.value = next
    } catch {
      /* 保留已加载的部分 */
    } finally {
      if (currentKey === key) {
        albumsLoading.value = false
        albumsLoaded.value = true
      }
    }
  }

  async function loadMoreMvs(): Promise<void> {
    if (mvsLoading.value || (mvsLoaded.value && !mvsHasMore.value) || !source) return
    const key = currentKey
    const next = mvsLoaded.value ? mvsPage.value + 1 : 0
    mvsLoading.value = true
    try {
      const r = await window.api.discover.artistMvs(source, artistId, next, MV_PAGE_SIZE)
      if (currentKey !== key) return
      mvs.value = next === 0 ? r.result : [...mvs.value, ...r.result]
      mvsHasMore.value = r.hasNext
      mvsPage.value = next
    } catch {
      /* 保留已加载的部分 */
    } finally {
      if (currentKey === key) {
        mvsLoading.value = false
        mvsLoaded.value = true
      }
    }
  }

  /** 切 Tab：专辑/MV 首次进入时懒加载 */
  function selectTab(next: ArtistTab): void {
    tab.value = next
    if (next === 'albums' && !albumsLoaded.value && !albumsLoading.value) void loadMoreAlbums()
    if (next === 'mvs' && !mvsLoaded.value && !mvsLoading.value) void loadMoreMvs()
  }

  function retry(): void {
    if (source && artistId) void load(source, artistId, true)
  }

  return {
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
    albumsLoaded,
    mvs,
    mvsLoading,
    mvsHasMore,
    mvsLoaded,
    scrollTop,
    setScroll,
    cachePreview,
    load,
    loadMoreSongs,
    loadMoreAlbums,
    loadMoreMvs,
    selectTab,
    retry
  }
})
