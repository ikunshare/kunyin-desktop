/* eslint-disable @typescript-eslint/no-explicit-any */
/** 酷狗解析：清洗、音质、搜索项、专辑歌曲(嵌套)、歌手歌曲(平铺) */
import type { KugouMusicItem, Quality, Singer } from '@common'

export const SQ_ZERO_HASH = '00000000000000000000000000000000'

export function num(v: any, def = 0): number {
  if (v == null) return def
  const n = Number(v)
  return Number.isFinite(n) ? n : def
}

export function cleanText(s: string): string {
  return String(s ?? '')
    .replace(/<\/?em>/g, '')
    .replace(/\//g, ' ')
    .trim()
}
export function limitSingers(s: string): string {
  if (!s.includes('、')) return s
  const parts = s.split('、')
  return parts.length > 5 ? parts.slice(0, 5).join('、') : s
}
function formatSize(bytes: number): string {
  if (bytes <= 0) return ''
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(1)}KB`
  const mb = kb / 1024
  if (mb < 1024) return `${mb.toFixed(1)}MB`
  return `${(mb / 1024).toFixed(1)}GB`
}
function addQ(
  q: Record<string, Quality>,
  id: string,
  name: string,
  bitrate: number,
  filesize: number
): void {
  q[id] = { id, name, filesize, bitrate, displaySize: formatSize(filesize) }
}
function toSingers(artist: string): Singer[] {
  return artist
    .split('、')
    .map((s) => ({ name: s.trim(), singerId: 0 }))
    .filter((s) => s.name)
}

/**
 * 带歌手 id 的 singers。酷狗各接口都给了歌手 id，只是字段位置不同：
 * 搜索用 `Singers[{name,id}]`（或 `SingerId[]`），专辑/歌手歌曲用 `authors[{author_name,author_id}]`。
 * 拿不到时回退按「、」拆名字（id=0，前端据此隐藏「查看歌手」入口）。
 */
function toSingersWithId(artist: string, raw: any[] | undefined): Singer[] {
  const list = (raw ?? [])
    .map((s) => ({
      name: cleanText(String(s?.name ?? s?.author_name ?? s?.base?.author_name ?? '')).trim(),
      singerId: num(s?.id ?? s?.author_id ?? s?.base?.author_id, 0)
    }))
    .filter((s) => s.name)
  return list.length ? list : toSingers(artist)
}

/** song_search_v2 结果项 */
export function parseSearchItem(info: any): KugouMusicItem | null {
  const hash = info.FileHash
  if (!hash) return null
  const q: Record<string, Quality> = {}
  const allHash: string[] = [hash]
  // 音质档以 size>0 为准；allHash 仅以 hash 非空为准（两者解耦，对齐源码 buildList）
  if (num(info.FileSize, 0) > 0) addQ(q, '128k', '普通音质 128K', 128, num(info.FileSize, 0))
  if (info.HQFileHash) {
    if (num(info.HQFileSize, 0) > 0) addQ(q, '320k', '高品音质 320K', 320, num(info.HQFileSize, 0))
    allHash.push(info.HQFileHash)
  }
  if (info.SQFileHash && info.SQFileHash !== SQ_ZERO_HASH) {
    if (num(info.SQFileSize, 0) > 0) addQ(q, 'flac', '无损音质 FLAC', 2000, num(info.SQFileSize, 0))
    allHash.push(info.SQFileHash)
  }
  if (info.ResFileHash) {
    if (num(info.ResFileSize, 0) > 0)
      addQ(q, 'hires', '无损音质 HiRes', 4000, num(info.ResFileSize, 0))
    allHash.push(info.ResFileHash)
  }
  if (!Object.keys(q).length) return null

  const audioId = String(info.MixSongID ?? '')
  const id = num(audioId, 0)
  // 源码：先在未清洗的 rawSongName 上判 suffix、拼接，整体再 cleanText
  const rawSongName = String(info.SongName ?? '')
  const suffix = String(info.Suffix ?? '')
  const title = cleanText(
    suffix && !rawSongName.includes(suffix) ? `${rawSongName}${suffix}` : rawSongName
  )
  const artist = limitSingers(cleanText(info.SingerName ?? ''))
  return {
    type: 'kg',
    id,
    title,
    artist,
    album: cleanText(info.AlbumName ?? ''),
    albumId: info.AlbumID != null ? String(info.AlbumID) : undefined,
    cover: '',
    duration: num(info.Duration, 0) * 1000,
    qualities: q,
    hash,
    allHash,
    audioId,
    mixsongmid: id,
    singers: toSingersWithId(
      artist,
      // 无 Singers 数组时用 SingerId[] 与 SingerName 同序对齐兜底
      Array.isArray(info.Singers) && info.Singers.length
        ? info.Singers
        : Array.isArray(info.SingerId)
          ? info.SingerId.map((sid: any, i: number) => ({
              name: artist.split('、')[i],
              id: sid
            }))
          : undefined
    ),
    mvid: info.mvdata?.[0]?.id ? String(info.mvdata[0].id) : undefined
  }
}

function buildFromHashes(
  hashMain: string,
  hash320: any,
  hashFlac: any,
  hashHigh: any,
  size128: number,
  size320: number,
  sizeFlac: number,
  sizeHigh: number
): { q: Record<string, Quality>; allHash: string[] } {
  const q: Record<string, Quality> = {}
  const allHash = [hashMain]
  // 音质档以 size>0 为准；allHash 仅以 hash 非空为准（对齐源码 buildList）
  if (size128 > 0) addQ(q, '128k', '普通音质 128K', 128, size128)
  if (hash320) {
    if (size320 > 0) addQ(q, '320k', '高品音质 320K', 320, size320)
    allHash.push(hash320)
  }
  if (hashFlac && hashFlac !== SQ_ZERO_HASH) {
    if (sizeFlac > 0) addQ(q, 'flac', '无损音质 FLAC', 2000, sizeFlac)
    allHash.push(hashFlac)
  }
  if (hashHigh) {
    if (sizeHigh > 0) addQ(q, 'hires', '无损音质 HiRes', 4000, sizeHigh)
    allHash.push(hashHigh)
  }
  return { q, allHash }
}

/** 专辑歌曲（嵌套 base/album_info/audio_info） */
export function parseKgAlbumSong(o: any): KugouMusicItem | null {
  const ai = o.audio_info ?? {}
  const hash = ai.hash_128 ?? ai.hash
  if (!hash) return null
  const { q, allHash } = buildFromHashes(
    hash,
    ai.hash_320,
    ai.hash_flac,
    ai.hash_high,
    num(ai.filesize_128 ?? ai.filesize, 0),
    num(ai.filesize_320, 0),
    num(ai.filesize_flac, 0),
    num(ai.filesize_high, 0)
  )
  if (!Object.keys(q).length) return null
  const base = o.base ?? {}
  const album = o.album_info ?? {}
  const audioId = String(base.album_audio_id ?? '')
  const id = num(audioId, 0)
  const artist = limitSingers(cleanText(base.author_name ?? ''))
  return {
    type: 'kg',
    id,
    title: cleanText(base.audio_name ?? ''),
    artist,
    album: album.album_name ?? '',
    albumId: base.album_id != null ? String(base.album_id) : undefined,
    cover: album.cover ? String(album.cover).replace('{size}', '480') : '',
    duration: num(ai.duration, 0),
    qualities: q,
    hash,
    allHash,
    audioId,
    mixsongmid: id,
    singers: toSingersWithId(artist, o.authors),
    mvid: o.mvdata?.[0]?.id ? String(o.mvdata[0].id) : undefined
  }
}

/** 歌手歌曲（平铺结构） */
export function parseKgAuthorSong(o: any): KugouMusicItem | null {
  const ai = o.audio_info ?? {}
  const hash = ai.hash
  if (!hash) return null
  const { q, allHash } = buildFromHashes(
    hash,
    ai.hash_320,
    ai.hash_flac,
    ai.hash_high,
    num(ai.filesize, 0),
    num(ai.filesize_320, 0),
    num(ai.filesize_flac, 0),
    num(ai.filesize_high, 0)
  )
  if (!Object.keys(q).length) return null
  const audioId = String(o.album_audio_id)
  const id = num(audioId, 0)
  let title = cleanText(o.audio_name ?? '')
  if (title.includes(' - ')) title = title.split(' - ').slice(1).join(' - ')
  const artist = limitSingers(cleanText(o.author_name ?? ''))
  const album = o.album_info ?? {}
  return {
    type: 'kg',
    id,
    title,
    artist,
    album: album.album_name ?? '',
    albumId: o.album_id != null ? String(o.album_id) : undefined,
    cover: album.cover ? String(album.cover).replace('{size}', '480') : '',
    duration: num(ai.timelength, 0),
    qualities: q,
    hash,
    allHash,
    audioId,
    mixsongmid: id,
    singers: toSingersWithId(artist, o.authors),
    mvid:
      o.mv_id && o.mv_id !== '0'
        ? String(o.mv_id)
        : o.mvdata?.[0]?.id
          ? String(o.mvdata[0].id)
          : undefined
  }
}
