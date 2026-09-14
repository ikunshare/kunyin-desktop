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
  /** 多碟专辑的分碟信息（单碟专辑/非整专下载缺省） */
  disc?: DownloadDisc
}

/**
 * 多碟专辑里某首歌所属的碟（整专下载时由专辑页按 `AlbumDisc` 切分逐首给出）。
 * 用途：按碟建子目录、写 DISCNUMBER/TPOS 等分碟标签。
 */
export interface DownloadDisc {
  /** 碟号，1 起 */
  no: number
  /** 总碟数 */
  total: number
  /** 碟名；接口只给默认名（CDn）时为空串，此时目录名与标签都退回碟号 */
  name: string
  /** 碟内轨号，1 起（标签里的 TRCK/TRACKNUMBER 按标准取碟内号） */
  trackNumber: number
}

/** 新增下载任务的入参 */
export interface AddDownloadInput {
  item: MusicItem
  /** 指定音质 id；不给则按首选音质从高到低选可用的 */
  qualityId?: string
  subDir?: string
  trackNumber?: number
  /** 多碟专辑：该曲所属碟（整专下载时逐首给出） */
  disc?: DownloadDisc
  /** 歌单名（groupByListName 开启时作为下载目录下的子目录名） */
  listName?: string
  /** MV 下载：给定 MV 清晰度（对应 getMvUrl 的 quality），任务走视频分支下 .mp4 */
  mvQuality?: string
}
