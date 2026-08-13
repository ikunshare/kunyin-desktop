/**
 * 发现 IPC —— 分发到各音源 Provider 的歌单/专辑/歌手 详情与搜索。
 * Provider 侧方法多已实现（wy/qq 最全，kg/kw 有专辑歌手），此处只做转发。
 */
import {
  IpcChannels,
  type AlbumInfoResult,
  type AlbumSearchResult,
  type ArtistCapabilities,
  type ArtistInfoResult,
  type ArtistMvResult,
  type ArtistSearchResult,
  type MusicItem,
  type MusicListResult,
  type MusicSource,
  type MvQuality,
  type MvUrlResult,
  type PlayListInfoResult,
  type PlaylistSearchResult
} from '@common'
import { handle } from '../helpers'
import { getProvider } from '../../providers'

function emptyList(source: MusicSource, page: number, size: number): MusicListResult {
  return { source, hasNext: false, page, size, result: [] }
}
function emptyPage<T>(
  source: MusicSource,
  page: number,
  size: number
): { source: MusicSource; hasNext: boolean; page: number; size: number; result: T[] } {
  return { source, hasNext: false, page, size, result: [] }
}

export function registerDiscoverHandlers(): void {
  handle(
    IpcChannels.DISCOVER_PLAYLIST_INFO,
    async (source: MusicSource, input: string): Promise<PlayListInfoResult | null> =>
      (await getProvider(source)?.getPlayListInfo(input)) ?? null
  )
  handle(
    IpcChannels.DISCOVER_PLAYLIST_SONGS,
    (
      source: MusicSource,
      id: string,
      page: number = 0,
      size: number = 30
    ): Promise<MusicListResult> =>
      getProvider(source)?.getPlayListSongs(id, page, size) ??
      Promise.resolve(emptyList(source, page, size))
  )
  handle(
    IpcChannels.DISCOVER_ALBUM_INFO,
    async (source: MusicSource, id: string): Promise<AlbumInfoResult | null> =>
      (await getProvider(source)?.getAlbumInfo(id)) ?? null
  )
  handle(
    IpcChannels.DISCOVER_ALBUM_SONGS,
    (
      source: MusicSource,
      id: string,
      page: number = 0,
      size: number = 30
    ): Promise<MusicListResult> =>
      getProvider(source)?.getAlbumSongs(id, page, size) ??
      Promise.resolve(emptyList(source, page, size))
  )
  handle(
    IpcChannels.DISCOVER_ARTIST_INFO,
    async (source: MusicSource, id: string): Promise<ArtistInfoResult | null> =>
      (await getProvider(source)?.getArtistInfo(id)) ?? null
  )
  handle(
    IpcChannels.DISCOVER_ARTIST_SONGS,
    (
      source: MusicSource,
      id: string,
      page: number = 0,
      size: number = 30
    ): Promise<MusicListResult> =>
      getProvider(source)?.getArtistSongs(id, page, size) ??
      Promise.resolve(emptyList(source, page, size))
  )
  handle(
    IpcChannels.DISCOVER_ARTIST_ALBUMS,
    (
      source: MusicSource,
      id: string,
      page: number = 0,
      size: number = 30
    ): Promise<AlbumSearchResult> =>
      getProvider(source)?.getArtistAlbums(id, page, size) ??
      Promise.resolve(emptyPage<AlbumInfoResult>(source, page, size))
  )
  handle(
    IpcChannels.DISCOVER_ARTIST_MVS,
    (
      source: MusicSource,
      id: string,
      page: number = 0,
      size: number = 40
    ): Promise<ArtistMvResult> =>
      getProvider(source)?.getArtistMvs(id, page, size) ??
      Promise.resolve({ source, hasNext: false, page, size, total: 0, result: [] })
  )
  handle(IpcChannels.DISCOVER_ARTIST_CAPS, (source: MusicSource): ArtistCapabilities => {
    const p = getProvider(source)
    return { albums: p?.supportsArtistAlbums() ?? false, mvs: p?.supportsArtistMvs() ?? false }
  })
  handle(
    IpcChannels.DISCOVER_ARTIST_MV_ITEM,
    (source: MusicSource, vid: string, title: string, cover: string): MusicItem | null =>
      getProvider(source)?.createMvItem(vid, title, cover) ?? null
  )
  handle(
    IpcChannels.DISCOVER_SEARCH_ALBUM,
    (
      source: MusicSource,
      keyword: string,
      page: number = 0,
      size: number = 20
    ): Promise<AlbumSearchResult> =>
      getProvider(source)?.searchAlbum(keyword, page, size) ??
      Promise.resolve(emptyPage<AlbumInfoResult>(source, page, size))
  )
  handle(
    IpcChannels.DISCOVER_SEARCH_ARTIST,
    (
      source: MusicSource,
      keyword: string,
      page: number = 0,
      size: number = 20
    ): Promise<ArtistSearchResult> =>
      getProvider(source)?.searchArtist(keyword, page, size) ??
      Promise.resolve(emptyPage<ArtistInfoResult>(source, page, size))
  )
  handle(
    IpcChannels.DISCOVER_SEARCH_PLAYLIST,
    (
      source: MusicSource,
      keyword: string,
      page: number = 0,
      size: number = 20
    ): Promise<PlaylistSearchResult> =>
      getProvider(source)?.searchPlaylist(keyword, page, size) ??
      Promise.resolve(emptyPage<PlayListInfoResult>(source, page, size))
  )
  handle(
    IpcChannels.DISCOVER_USER_PLAYLISTS,
    async (source: MusicSource): Promise<PlayListInfoResult[]> =>
      (await getProvider(source)?.getUserPlaylist()) ?? []
  )
  handle(
    IpcChannels.DISCOVER_MV_QUALITIES,
    async (source: MusicSource, item: MusicItem): Promise<MvQuality[]> =>
      (await getProvider(source)?.getMvQualities(item)) ?? []
  )
  handle(
    IpcChannels.DISCOVER_MV_URL,
    async (source: MusicSource, item: MusicItem, quality: string): Promise<MvUrlResult> =>
      (await getProvider(source)?.getMvUrl(item, quality)) ?? {
        source,
        playUrl: null,
        quality,
        rejectReason: '未支持'
      }
  )
}
