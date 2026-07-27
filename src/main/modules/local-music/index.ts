/**
 * 本地歌曲导入（LX「添加本地歌曲」）。
 *
 * 弹系统文件选择框（多选音频文件）→ music-metadata 解析标签 → LocalMusicItem 入歌单。
 * - id 为文件绝对路径的 SHA-1 前 52 bit（确定性数值，重复导入被 INSERT OR IGNORE 去重）；
 * - 标签缺失时回退文件名解析（"艺术家 - 标题" 或纯标题）；
 * - 内嵌封面不入库（song_json 会进 SQLite，塞 base64 图会把库撑爆），封面留空。
 */
import { createHash } from 'node:crypto'
import { basename, extname } from 'node:path'
import { dialog } from 'electron'
import type { LocalMusicItem } from '@common'
import { getMainWindow } from '../../windows/main'

export const AUDIO_EXTENSIONS = ['mp3', 'flac', 'wav', 'm4a', 'aac', 'ogg', 'opus', 'wma', 'ape']

/** 文件绝对路径 → 确定性数值 id（SHA-1 前 13 个 hex ≈ 52 bit，Number 安全范围内） */
export function localSongId(filePath: string): number {
  const hex = createHash('sha1').update(filePath).digest('hex').slice(0, 13)
  return parseInt(hex, 16)
}

/** "艺术家 - 标题.ext" / "标题.ext" → { title, artist } */
function parseFileName(filePath: string): { title: string; artist: string } {
  const base = basename(filePath, extname(filePath)).trim()
  const sep = base.indexOf(' - ')
  if (sep > 0) {
    return { artist: base.slice(0, sep).trim(), title: base.slice(sep + 3).trim() }
  }
  return { title: base, artist: '' }
}

/** 解析单个文件为 LocalMusicItem；标签解析失败也不丢文件（回退文件名） */
export async function parseLocalSong(filePath: string): Promise<LocalMusicItem> {
  const fallback = parseFileName(filePath)
  let title = fallback.title
  let artist = fallback.artist
  let album = ''
  let duration = 0
  try {
    // music-metadata 为 ESM-only 包，主进程 CJS 侧用动态 import 加载
    const mm = await import('music-metadata')
    const meta = await mm.parseFile(filePath, { duration: true, skipCovers: true })
    if (meta.common.title?.trim()) title = meta.common.title.trim()
    const artists = meta.common.artists?.length ? meta.common.artists : [meta.common.artist ?? '']
    const joined = artists.filter(Boolean).join('、')
    if (joined) artist = joined
    album = meta.common.album?.trim() ?? ''
    duration = Math.round((meta.format.duration ?? 0) * 1000)
  } catch {
    /* 无标签/不支持的容器：回退文件名 + 时长 0（播放时 <audio> 会读到真实时长） */
  }
  return {
    type: 'local',
    id: localSongId(filePath),
    title,
    artist,
    album,
    cover: '',
    duration,
    qualities: {},
    filePath
  }
}

/** 弹多选文件框；取消返回 null */
export async function pickLocalSongs(): Promise<string[] | null> {
  const win = getMainWindow()
  const r = await dialog.showOpenDialog(win ?? undefined!, {
    title: '添加本地歌曲',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: '音频文件', extensions: AUDIO_EXTENSIONS }]
  })
  return r.canceled || !r.filePaths.length ? null : r.filePaths
}
