/**
 * 音频标签库门面（1:1 移植自 Android utils/tag/MusicTagger.kt）。
 * 按扩展名分发 mp3(ID3v2) / flac(Vorbis Comment) / ogg(Vorbis/Opus 评论头) 处理器。
 * 其它扩展名静默忽略（与 Android 一致）。
 */
import type { MusicMeta } from './meta'
import { readMp3, writeMp3 } from './mp3'
import { readFlacMeta, writeFlac } from './flac'
import { readOggMeta, writeOgg } from './ogg'

export type { MusicMeta, ParsedImage } from './meta'
export { sniffImageMime } from './meta'
export { parseImage, parseImageFile } from './image'

export async function readAudioTags(filePath: string): Promise<MusicMeta | null> {
  const lower = filePath.toLowerCase()
  if (lower.endsWith('.mp3')) return readMp3(filePath)
  if (lower.endsWith('.flac')) return readFlacMeta(filePath)
  if (lower.endsWith('.ogg')) return readOggMeta(filePath)
  return null
}

export async function writeAudioTags(filePath: string, meta: MusicMeta): Promise<void> {
  const lower = filePath.toLowerCase()
  if (lower.endsWith('.mp3')) return writeMp3(filePath, meta)
  if (lower.endsWith('.flac')) return writeFlac(filePath, meta)
  if (lower.endsWith('.ogg')) return writeOgg(filePath, meta)
}

/**
 * 读出现有标签 → 合并给定字段 → 写回（对应 Android MusicTagger.edit）。
 * meta 中 undefined 字段保留原值；显式想要清空的字段暂无需求，故不支持 null 语义。
 */
export async function editAudioTags(filePath: string, meta: MusicMeta): Promise<void> {
  const existing = await readAudioTags(filePath)
  await writeAudioTags(filePath, { ...(existing ?? {}), ...meta })
}

/** 字段是否已有实质内容（空串/空图视为缺失） */
function hasValue(v: MusicMeta[keyof MusicMeta] | undefined): boolean {
  if (v == null) return false
  if (typeof v === 'string') return v.trim().length > 0
  if (Buffer.isBuffer(v)) return v.length > 0
  return true
}

function fillIfMissing<K extends keyof MusicMeta>(
  merged: MusicMeta,
  key: K,
  wanted: MusicMeta[K]
): void {
  if (!hasValue(wanted)) return
  if (!hasValue(merged[key])) merged[key] = wanted
}

/**
 * 补齐缺失字段（下载流程专用）：文件中已内嵌的字段保留不动，
 * 仅填充缺失字段。下载文件自带的标签通常更准 —— 例如 QQ mflac/mgg 解密后
 * 保留的原容器标签、直链 mp3 的 ID3，都优先于任务表里的搜索数据。
 */
export async function fillAudioTags(filePath: string, meta: MusicMeta): Promise<void> {
  const existing = (await readAudioTags(filePath)) ?? {}
  const merged: MusicMeta = { ...existing }
  const keys: (keyof MusicMeta)[] = [
    'title',
    'artist',
    'album',
    'trackNumber',
    'lyrics',
    'picture',
    'pictureData',
    'pictureMimeType'
  ]
  for (const key of keys) fillIfMissing(merged, key, meta[key])
  await writeAudioTags(filePath, merged)
}
