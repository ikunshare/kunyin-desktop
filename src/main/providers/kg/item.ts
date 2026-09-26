/* eslint-disable @typescript-eslint/no-explicit-any */
/** 酷狗解析：清洗、音质、搜索项、专辑歌曲(嵌套)、歌手歌曲(平铺) */
import { qualityName, type KugouMusicItem, type Quality, type Singer } from '@common'

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

/**
 * thirdsso `favorite/song` 的歌单曲目。
 *
 * 这套接口不给各档位的 hash，只给一个主 hash 与 `support_quality` 码表；
 * 文件大小也要另外走 `song/infos` 补（见 KgProvider.enrichWithSongInfos）。
 */
export function parseKgPlaylistSong(o: any): KugouMusicItem | null {
  const hash = o.hash
  if (!hash) return null
  const q = buildQualitiesFromSupport(String(o.support_quality ?? ''))
  if (!Object.keys(q).length) return null

  const audioId = String(o.song_id ?? '')
  const id = num(audioId, 0)
  const artist = limitSingers(cleanText(o.singer_name ?? ''))
  const rawSingers: any[] | undefined = Array.isArray(o.singers) ? o.singers : undefined
  return {
    type: 'kg',
    id,
    title: cleanText(o.song_name ?? ''),
    artist,
    album: o.album_name ?? '',
    albumId: o.album_id != null ? String(o.album_id) : undefined,
    cover: o.album_img_medium ?? '',
    duration: num(o.duration, 0),
    qualities: q,
    hash,
    allHash: [hash],
    audioId,
    mixsongmid: id,
    singers: toSingersWithId(
      artist,
      rawSingers?.map((s) => ({ name: s?.singer_name, id: s?.singer_id }))
    ),
    mvid: o.mv_id && String(o.mv_id) !== '0' ? String(o.mv_id) : undefined
  }
}

/** `support_quality` 码表 → 音质档（大小为 0，之后由 song/infos 回填） */
function buildQualitiesFromSupport(support: string): Record<string, Quality> {
  const codes = support.split(',').map((c) => c.trim())
  const q: Record<string, Quality> = {}
  const has = (...want: string[]): boolean => want.some((w) => codes.includes(w))
  if (has('LQ', 'HQ')) addQ(q, '128k', '普通音质 128K', 128, 0)
  if (has('SQ', 'PQ')) addQ(q, '320k', '高品音质 320K', 320, 0)
  if (has('VCQ')) addQ(q, 'flac', '无损音质 FLAC', 2000, 0)
  if (has('TQ')) addQ(q, 'hires', '无损音质 HiRes', 4000, 0)
  if (has('AQ')) addQ(q, 'master', qualityName('master', 'kg'), 20900, 0)
  return q
}

/** song/infos 回填各档位大小（键名对齐 Android enrichWithSongInfos） */
export function applyKgSongSizes(item: KugouMusicItem, s: any): void {
  const set = (id: string, bytes: number): void => {
    const q = item.qualities[id]
    if (!q || bytes <= 0) return
    item.qualities[id] = { ...q, filesize: bytes, displaySize: formatSize(bytes) }
  }
  set('128k', num(s.song_size, 0))
  set('320k', num(s.song_size_hq, 0))
  set('flac', num(s.song_size_sq, 0))
  set('hires', num(s.song_size_vcq, 0))
  set('master', num(s.song_size_aq, 0))
}

/** 排行榜 `api/v3/rank/song` 曲目（平铺；duration 为秒） */
export function parseKgRankSong(o: any): KugouMusicItem | null {
  const hash = o?.hash
  if (!hash) return null
  const { q, allHash } = buildFromHashes(
    hash,
    o['320hash'],
    o.sqhash,
    o.hash_high,
    num(o.filesize, 0),
    num(o['320filesize'], 0),
    num(o.sqfilesize, 0),
    num(o.filesize_high, 0)
  )
  if (!Object.keys(q).length) return null
  const audioId = String(o.album_audio_id ?? o.audio_id ?? '')
  const id = num(audioId, 0)
  const authors: any[] = Array.isArray(o.authors) ? o.authors : []
  const rawArtist = authors.length
    ? authors
        .map((a) => a?.author_name ?? '')
        .filter(Boolean)
        .join('、')
    : String(o.singername ?? o.filename ?? '').split(' - ')[0]
  const artist = limitSingers(cleanText(rawArtist))
  const unionCover = o.trans_param?.union_cover ?? o.album_sizable_cover
  return {
    type: 'kg',
    id,
    title: cleanText(o.songname ?? ''),
    artist,
    album: cleanText(o.remark ?? o.album_name ?? ''),
    albumId: o.album_id != null && String(o.album_id) !== '0' ? String(o.album_id) : undefined,
    cover: unionCover ? String(unionCover).replace('{size}', '480') : '',
    duration: num(o.duration, 0) * 1000,
    qualities: q,
    hash,
    allHash,
    audioId,
    mixsongmid: id,
    singers: toSingersWithId(artist, authors)
  }
}

/** `gateway.kugou.com/v2/album_audio/audio` 批量详情（公开歌单用；timelength 为毫秒） */
export function parseKgAudioInfo(o: any): KugouMusicItem | null {
  const ai = o?.audio_info ?? {}
  const hash = ai.hash ?? ai.hash_128
  if (!hash) return null
  const { q, allHash } = buildFromHashes(
    hash,
    ai.hash_320,
    ai.hash_flac,
    ai.hash_high,
    num(ai.filesize ?? ai.filesize_128, 0),
    num(ai.filesize_320, 0),
    num(ai.filesize_flac, 0),
    num(ai.filesize_high, 0)
  )
  if (!Object.keys(q).length) return null
  const base = o.base ?? {}
  const album = o.album_info ?? {}
  const audioId = String(base.album_audio_id ?? ai.album_audio_id ?? ai.audio_id ?? '')
  const id = num(audioId, 0)
  const artist = limitSingers(cleanText(o.author_name ?? base.author_name ?? ''))
  const cover = album.sizable_cover ?? album.cover
  return {
    type: 'kg',
    id,
    title: cleanText(o.songname ?? base.audio_name ?? o.ori_audio_name ?? ''),
    artist,
    album: cleanText(album.album_name ?? ''),
    albumId:
      album.album_id != null && String(album.album_id) !== '0' ? String(album.album_id) : undefined,
    cover: cover ? String(cover).replace('{size}', '480') : '',
    duration: num(ai.timelength ?? ai.duration, 0),
    qualities: q,
    hash,
    allHash,
    audioId,
    mixsongmid: id,
    singers: toSingersWithId(artist, o.authors)
  }
}
