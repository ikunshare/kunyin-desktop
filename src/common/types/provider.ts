/**
 * Provider 结果 DTO（对应 Android 端 platform/base/ProviderResults.kt）
 *
 * 这些是主进程各音源方法的返回类型，经 IPC 传给渲染层，故置于共享层。
 * BaseProvider 抽象类本身是主进程实现细节，放在 src/main/providers。
 */
import type { MusicItem, MusicSource } from './music'

/** 搜索类型 */
export enum SearchType {
  Song = 'song',
  Playlist = 'playlist',
  Album = 'album',
  Artist = 'artist'
}

/** 歌曲列表结果（搜索 / 歌单曲目 / 专辑曲目 / 歌手热门 共用） */
export interface MusicListResult {
  source: MusicSource
  hasNext: boolean
  page: number
  size: number
  result: MusicItem[]
  /** 同步/导入场景：跳过的本地歌曲数 */
  skippedLocalSongs?: number
}

/**
 * 加密信息 —— 加密音源播放的核心载体。
 * ekey 非空且 isEncrypt 时，客户端需边下边解密（QQ mflac/mgg 等）。
 */
export interface EncryptionInfo {
  isEncrypt: boolean
  ekey?: string
}

/** 播放地址解析结果（对应 MediaInfoResult） */
export interface MediaInfoResult {
  source: MusicSource
  playUrl: string
  backupUrls?: string[]
  /** 直链过期时间戳（毫秒） */
  expire: number
  isSuccess: boolean
  /** 实际命中的音质 id */
  quality: string
  musicItem?: MusicItem
  rejectReason?: string
  encryptionInfo?: EncryptionInfo
}

/** 本地音频代理结果：可直接喂 <audio> 的 127.0.0.1 URL */
export interface AudioStreamResult {
  ok: boolean
  /** 本地代理 URL（http://127.0.0.1:port/s/...） */
  url: string
  /** 直链过期时间戳（毫秒） */
  expire: number
  /** 实际命中的音质 id */
  quality: string
  reason?: string
}

/** 歌单信息 */
export interface PlayListInfoResult {
  source: MusicSource
  id: string
  name: string
  cover?: string
  creator?: string
  description?: string
  playCount?: number
  /** 曲目总数 */
  total?: number
}

/** 专辑信息 */
export interface AlbumInfoResult {
  source: MusicSource
  id: string
  name: string
  cover?: string
  artist?: string
  publishTime?: string
  description?: string
  total?: number
}

/** 歌手信息 */
export interface ArtistInfoResult {
  source: MusicSource
  id: string
  name: string
  cover?: string
  description?: string
  songCount?: number
  albumCount?: number
}

/** 分页搜索结果（歌单 / 专辑 / 歌手） */
export interface PlaylistSearchResult {
  source: MusicSource
  hasNext: boolean
  page: number
  size: number
  result: PlayListInfoResult[]
}

export interface AlbumSearchResult {
  source: MusicSource
  hasNext: boolean
  page: number
  size: number
  result: AlbumInfoResult[]
}

export interface ArtistSearchResult {
  source: MusicSource
  hasNext: boolean
  page: number
  size: number
  result: ArtistInfoResult[]
}

/** MV 音质档（对应 Android MvQuality） */
export interface MvQuality {
  quality: string
  displayName: string
  displaySize?: string
}

/** MV 播放地址（对应 Android MvUrlResult：playUrl 可空，失败给 rejectReason） */
export interface MvUrlResult {
  source: MusicSource
  playUrl: string | null
  quality: string
  rejectReason?: string
}

/** 登录用户信息 */
export interface UserInfo {
  source: MusicSource
  uid: string
  nickname: string
  avatar?: string
  vipType?: string
}
