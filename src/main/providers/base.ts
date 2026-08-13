/**
 * 音源 Provider 抽象基类（对应 Android platform/base/BaseProvider.kt）。
 * 各平台在 providers/<source>/ 下实现；返回类型为 @common 的 DTO。
 */
import {
  EMPTY_LYRIC,
  type AlbumInfoResult,
  type AlbumSearchResult,
  type ArtistInfoResult,
  type ArtistMvResult,
  type ArtistSearchResult,
  type Lyric,
  type MediaInfoResult,
  type MusicItem,
  type MusicListResult,
  type MusicSource,
  type MvQuality,
  type MvUrlResult,
  type PlayListInfoResult,
  type PlaylistSearchResult,
  type UserInfo
} from '@common'

/** 登录/凭据态（cookie 等），由 credentials 模块注入 */
export interface ProviderCredentials {
  cookie?: string
  [key: string]: unknown
}

export abstract class BaseProvider {
  abstract readonly source: MusicSource
  abstract readonly displayName: string

  /** 登录态；未登录为 null */
  credentials: ProviderCredentials | null = null

  // —— 搜索 ——
  abstract search(keyword: string, page?: number, size?: number): Promise<MusicListResult>
  async getHotSearch(): Promise<string[]> {
    return []
  }
  async getSearchTip(_keyword: string): Promise<string[]> {
    return []
  }
  async searchAlbum(_keyword: string, _page?: number, _size?: number): Promise<AlbumSearchResult> {
    return this.emptyPage()
  }
  async searchArtist(
    _keyword: string,
    _page?: number,
    _size?: number
  ): Promise<ArtistSearchResult> {
    return this.emptyPage()
  }
  async searchPlaylist(
    _keyword: string,
    _page?: number,
    _size?: number
  ): Promise<PlaylistSearchResult> {
    return this.emptyPage()
  }

  // —— 歌单 ——
  async getPlayListInfo(_input: string): Promise<PlayListInfoResult | null> {
    return null
  }
  async getPlayListSongs(_id: string, page = 0, size = 30): Promise<MusicListResult> {
    return this.emptyList(page, size)
  }
  async getUserPlaylist(): Promise<PlayListInfoResult[]> {
    return []
  }
  async getUserInfo(): Promise<UserInfo | null> {
    return null
  }

  // —— 专辑 / 歌手 ——
  async getAlbumInfo(_id: string): Promise<AlbumInfoResult | null> {
    return null
  }
  async getAlbumSongs(_id: string, page = 0, size = 30): Promise<MusicListResult> {
    return this.emptyList(page, size)
  }
  async getArtistInfo(_id: string): Promise<ArtistInfoResult | null> {
    return null
  }
  async getArtistSongs(_id: string, page = 0, size = 30): Promise<MusicListResult> {
    return this.emptyList(page, size)
  }
  /** 是否有「专辑」Tab（歌手页据此隐藏该 Tab） */
  supportsArtistAlbums(): boolean {
    return false
  }
  /** 是否有「MV」Tab */
  supportsArtistMvs(): boolean {
    return false
  }
  async getArtistAlbums(_id: string, page = 0, size = 30): Promise<AlbumSearchResult> {
    return this.emptyPage(page, size)
  }
  async getArtistMvs(_id: string, page = 0, size = 40): Promise<ArtistMvResult> {
    return { source: this.source, hasNext: false, page, size, total: 0, result: [] }
  }
  /**
   * 由 MV 列表条目造一个仅够取流播放的占位 MusicItem（mvid 为核心字段）。
   * 歌手页 MV Tab 点击后交给 MvPlayer 复用 getMvQualities/getMvUrl。
   */
  createMvItem(_vid: string, _title: string, _cover: string): MusicItem | null {
    return null
  }

  // —— MV ——
  /** MV 可用清晰度（依赖 item.mvid），无则空 */
  async getMvQualities(_item: MusicItem): Promise<MvQuality[]> {
    return []
  }
  /** MV 播放地址；playUrl 为 null 表示失败，rejectReason 说明原因 */
  async getMvUrl(_item: MusicItem, quality: string): Promise<MvUrlResult> {
    return { source: this.source, playUrl: null, quality, rejectReason: '未实现' }
  }

  // —— 播放 / 歌词 ——
  async getLyric(_item: MusicItem): Promise<Lyric> {
    return { ...EMPTY_LYRIC }
  }
  /** 默认返回 null → 由后端 getUrl 统一解析播放地址 */
  async resolveMediaInfo(_item: MusicItem, _qualityId: string): Promise<MediaInfoResult | null> {
    return null
  }

  // —— helpers ——
  protected emptyList(page = 0, size = 20): MusicListResult {
    return { source: this.source, hasNext: false, page, size, result: [] }
  }
  protected emptyPage(
    page = 0,
    size = 20
  ): { source: MusicSource; hasNext: boolean; page: number; size: number; result: [] } {
    return { source: this.source, hasNext: false, page, size, result: [] }
  }

  protected getCredential<T = string>(key: string): T | undefined {
    return this.credentials?.[key] as T | undefined
  }
}
