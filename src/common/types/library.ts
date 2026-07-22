/**
 * 本地曲库共享类型（对应 Android database/Playlist.kt）。
 * 主进程 store/library.ts 产出，经 IPC 传给渲染层，故置于共享层。
 */
import type { MusicSource } from './music'

/** 本地歌单（系统歌单为 isSystem=true，systemKind 区分试听/收藏） */
export interface LocalPlaylist {
  id: number
  name: string
  createdAt: number
  /** 曲目数 */
  songCount: number
  /** 首曲封面（无曲目时空） */
  coverUrl?: string
  /** 平台歌单本地副本的来源音源 */
  remoteSource?: string
  /** 平台歌单本地副本的远端 id */
  remoteId?: string
  autoRefresh: boolean
  isSystem: boolean
  /** 系统歌单种类：'trial'（试听列表）| 'favorites'（我的收藏） */
  systemKind?: 'trial' | 'favorites'
}

/** 系统歌单种类常量 */
export const SYSTEM_KIND = {
  TRIAL: 'trial',
  FAVORITES: 'favorites'
} as const

export type SystemKind = (typeof SYSTEM_KIND)[keyof typeof SYSTEM_KIND]

/** 平台歌单缓存查询键 */
export interface RemotePlaylistRef {
  source: MusicSource
  remoteId: string
}
