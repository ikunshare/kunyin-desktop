/**
 * 下载任务共享类型（对应 Android ui/screens/download/DownloadTask.kt + DownloadStatus）。
 * 主进程 modules/download 产出，经 IPC 传给渲染层。
 */
import type { MusicItem } from './music'

export type DownloadStatus = 'waiting' | 'downloading' | 'paused' | 'completed' | 'failed'

export interface DownloadTask {
  /** 唯一键：`source_id_qualityId` */
  taskKey: string
  songId: number
  source: string
  title: string
  artist: string
  album: string
  cover: string
  qualityId: string
  qualityName: string
  status: DownloadStatus
  /** 0..1 */
  progress: number
  /** 字节/秒 */
  speedBytesPerSec: number
  downloadedBytes: number
  totalBytes: number
  /** 完成后的最终文件路径 */
  filePath: string
  errorMessage: string
  /** 整专下载时的子目录（专辑名） */
  subDir: string
  /** 按歌单名分组下载时的子目录（歌单名，groupByListName 开启时使用） */
  listName: string
  /** 整专下载时的轨号（>0 时文件名前缀两位轨号） */
  trackNumber: number
}

/** 新增下载任务的入参 */
export interface AddDownloadInput {
  item: MusicItem
  /** 指定音质 id；不给则按首选音质从高到低选可用的 */
  qualityId?: string
  subDir?: string
  trackNumber?: number
  /** 歌单名（groupByListName 开启时作为下载目录下的子目录名） */
  listName?: string
  /** MV 下载：给定 MV 清晰度（对应 getMvUrl 的 quality），任务走视频分支下 .mp4 */
  mvQuality?: string
}
