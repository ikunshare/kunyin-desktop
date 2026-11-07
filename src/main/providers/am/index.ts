import {
  EMPTY_LYRIC,
  type AlbumInfoResult,
  type AppleMusicItem,
  type AlbumSearchResult,
  type ArtistInfoResult,
  type ArtistSearchResult,
  type Lyric,
  type MusicItem,
  type MusicListResult
} from '@common'
import { BaseProvider } from '../base'
import { amPost, type AmResponse } from './api'
import { parseAppleAlbum, parseAppleArtist, parseAppleSong } from './item'

export class AmProvider extends BaseProvider {
  readonly source = 'am' as const
  readonly displayName = 'Apple Music'

  async search(keyword: string, page = 0, size = 20): Promise<MusicListResult> {
    const response = await amPost('/music/search', {
      source: this.source,
      keyword,
      type: 'song',
      page: page + 1,
      limit: size
    }).catch(() => null)
    const items = Array.isArray(response?.data) ? response.data : []
    return {
      source: this.source,
      hasNext: !!response?.hasNext,
      page,
      size,
      total: response?.total,
      result: items.map(parseAppleSong).filter((item): item is AppleMusicItem => !!item)
    }
  }

  async searchAlbum(keyword: string, page = 0, size = 20): Promise<AlbumSearchResult> {
    const response = await amPost('/music/search', {
      source: this.source,
      keyword,
      type: 'album',
      page: page + 1,
      limit: size
    }).catch(() => null)
    const items = Array.isArray(response?.data) ? response.data : []
    return {
      source: this.source,
      hasNext: !!response?.hasNext,
      page,
      size,
      result: items.map(parseAppleAlbum).filter((item): item is AlbumInfoResult => !!item)
    }
  }

  async searchArtist(keyword: string, page = 0, size = 20): Promise<ArtistSearchResult> {
    const response = await amPost('/music/search', {
      source: this.source,
      keyword,
      type: 'artist',
      page: page + 1,
      limit: size
    }).catch(() => null)
    const items = Array.isArray(response?.data) ? response.data : []
    return {
      source: this.source,
      hasNext: !!response?.hasNext,
      page,
      size,
      result: items.map(parseAppleArtist).filter((item): item is ArtistInfoResult => !!item)
    }
  }

  async getAlbumInfo(id: string): Promise<AlbumInfoResult | null> {
    const response = await this.fetchAlbum(id, 0, 1).catch(() => null)
    return parseAppleAlbum(response?.info)
  }

  async getAlbumSongs(id: string, page = 0, size = 100): Promise<MusicListResult> {
    const songs: AppleMusicItem[] = []
    let response: AmResponse | null = null
    let current = page
    try {
      for (let count = 0; count < 50; count++, current++) {
        response = await this.fetchAlbum(id, current, size)
        const items = Array.isArray(response.data) ? response.data : []
        songs.push(...items.map(parseAppleSong).filter((item): item is AppleMusicItem => !!item))
        if (!response.hasNext) break
      }
    } catch {
      if (!response) return this.emptyList(page, size)
    }
    return {
      source: this.source,
      hasNext: false,
      page,
      size: songs.length,
      total: response?.total ?? songs.length,
      result: songs,
      discs: response?.discs?.length ? response.discs : undefined
    }
  }

  private fetchAlbum(id: string, page: number, size: number): Promise<AmResponse> {
    return amPost('/music/album', { source: this.source, musicId: id, page: page + 1, limit: size })
  }

  async getArtistInfo(id: string): Promise<ArtistInfoResult | null> {
    const response = await amPost('/music/artist', {
      source: this.source,
      musicId: id,
      view: 'songs',
      page: 1,
      limit: 1
    }).catch(() => null)
    return parseAppleArtist(response?.info)
  }

  async getArtistSongs(id: string, page = 0, size = 30): Promise<MusicListResult> {
    const response = await this.fetchArtist(id, 'songs', page, size).catch(() => null)
    const items = Array.isArray(response?.data) ? response.data : []
    return {
      source: this.source,
      hasNext: !!response?.hasNext,
      page,
      size,
      total: response?.total,
      result: items.map(parseAppleSong).filter((item): item is AppleMusicItem => !!item)
    }
  }

  supportsArtistAlbums(): boolean {
    return true
  }

  async getArtistAlbums(id: string, page = 0, size = 30): Promise<AlbumSearchResult> {
    const response = await this.fetchArtist(id, 'albums', page, size).catch(() => null)
    const items = Array.isArray(response?.data) ? response.data : []
    return {
      source: this.source,
      hasNext: !!response?.hasNext,
      page,
      size,
      result: items.map(parseAppleAlbum).filter((item): item is AlbumInfoResult => !!item)
    }
  }

  private fetchArtist(
    id: string,
    view: 'songs' | 'albums',
    page: number,
    size: number
  ): Promise<AmResponse> {
    return amPost('/music/artist', {
      source: this.source,
      musicId: id,
      view,
      page: page + 1,
      limit: size
    })
  }

  async getLyric(item: MusicItem): Promise<Lyric> {
    if (item.type !== 'am') return { ...EMPTY_LYRIC }
    const response = await amPost('/music/lyric', {
      source: this.source,
      musicId: String(item.id)
    }).catch(() => null)
    const data = response?.data
    if (!data) return { ...EMPTY_LYRIC }
    return {
      lrc: data.lyric ?? '',
      trans: data.trans ?? '',
      roma: data.roma ?? '',
      char: data.chase ?? '',
      chroma: data.chroma ?? '',
      phonetic: '',
      // 原样 TTML：渲染层优先用它（逐字结束时间、和声、对唱、ruby 都在里面）
      ttml: typeof data.ttml === 'string' ? data.ttml : ''
    }
  }
}
