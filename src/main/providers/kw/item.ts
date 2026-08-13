/* eslint-disable @typescript-eslint/no-explicit-any */
/** 酷我解析：音质表、搜索项(JSON)、歌曲元素(XML)、详情项(musicpay JSON) */
import type { KuwoMusicItem, Quality, Singer } from '@common'

export function num(v: any, def = 0): number {
  if (v == null) return def
  const n = Number(v)
  return Number.isFinite(n) ? n : def
}

const MINFO_RE = /level:(\w+),bitrate:(\d+),format:(\w+),size:([\w.]+)/
// bitrate → [id, name, bitrate]
const KW_QUALITY: Record<string, [string, string, number]> = {
  '128': ['128k', '普通音质 128K', 128],
  '320': ['320k', '高品音质 320K', 320],
  '2000': ['flac', '无损音质 FLAC', 2000],
  '4000': ['hires', '无损音质 HiRes', 4000],
  '20201': ['atmos', '臻品全景声', 20201],
  '20501': ['atmos_plus', '臻品全景声 2.0', 20501],
  '20900': ['master', '臻品母带', 20900]
}

export function parseMinfo(minfo: string): Record<string, Quality> {
  const q: Record<string, Quality> = {}
  for (const seg of minfo.split(';')) {
    const m = MINFO_RE.exec(seg)
    if (!m) continue
    const map = KW_QUALITY[m[2]]
    if (!map) continue
    const [id, name, bitrate] = map
    q[id] = { id, name, filesize: 0, bitrate, displaySize: m[4].toUpperCase() }
  }
  return q
}

/**
 * 拆歌手。酷我用 `&` 分隔歌手名，歌手 id 在 `allartistid`（或 XML 的 artistid）里**按同序**
 * 用 `&` 分隔，例：ARTIST="蔡依林&周杰伦" ↔ allartistid="978&336"。
 * 缺 id 的位置给 0，前端据此隐藏「查看歌手」入口。
 */
function splitSingers(artist: string, artistIds?: string): Singer[] {
  const ids = (artistIds ?? '').split('&').map((s) => num(s.trim(), 0))
  return artist
    .split('&')
    .map((s, i) => ({ name: s.trim(), singerId: ids[i] ?? 0 }))
    .filter((s) => s.name)
}

/** 搜索结果项（JSON，key 大写） */
export function parseSearchItem(info: any): KuwoMusicItem | null {
  const rid = info.MUSICRID
  if (!rid) return null
  const id = num(String(rid).replace('MUSIC_', ''), 0)
  if (!id) return null
  const minfo = info.N_MINFO
  if (!minfo) return null
  const artist = info.ARTIST ?? ''
  const singers = splitSingers(
    artist,
    info.allartistid != null ? String(info.allartistid) : info.ARTISTID
  )
  return {
    type: 'kw',
    id,
    title: info.SONGNAME ?? '',
    artist,
    album: info.ALBUM ?? '',
    albumId: info.ALBUMID != null ? String(info.ALBUMID) : undefined,
    cover: '', // fetchCovers 后补
    duration: num(info.DURATION, 0) * 1000,
    qualities: parseMinfo(minfo),
    singers: singers.length ? singers : undefined
  }
}

// —— XML 属性解析 ——
function attr(el: string, name: string): string | undefined {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(el)
  return m ? m[1] : undefined
}
export function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

export function parseMusicElement(el: string): KuwoMusicItem | null {
  const id = num(attr(el, 'rid'), 0)
  if (!id) return null
  const name = attr(el, 'name')
  if (!name) return null
  const minfo = attr(el, 'n_minfo') ?? attr(el, 'minfo')
  if (!minfo) return null
  const qualities = parseMinfo(unescapeXml(minfo))
  if (!Object.keys(qualities).length) return null
  const artist = unescapeXml(attr(el, 'artist') ?? '')
  const vid = attr(el, 'vid')
  const singers = splitSingers(artist, attr(el, 'allartistid') ?? attr(el, 'artistid'))
  return {
    type: 'kw',
    id,
    title: unescapeXml(name),
    artist,
    album: unescapeXml(attr(el, 'album') ?? ''),
    albumId: attr(el, 'albumid'),
    cover: attr(el, 'img') ?? '',
    duration: num(attr(el, 'duration'), 0) * 1000,
    qualities,
    singers: singers.length ? singers : undefined,
    mvid: vid && vid !== '0' ? vid : undefined
  }
}

export function parseMusicElements(xml: string): KuwoMusicItem[] {
  const out: KuwoMusicItem[] = []
  const re = /<music\b[^>]*?\/?>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xml))) {
    const it = parseMusicElement(m[0])
    if (it) out.push(it)
  }
  return out
}

/** musicpay 详情项 */
export function parseMusicPayItem(s: any): KuwoMusicItem | null {
  const id = num(s.id, 0)
  if (!id) return null
  const name = s.name
  if (!name) return null
  const minfo = s.N_MINFO
  if (!minfo) return null
  const qualities = parseMinfo(minfo)
  if (!Object.keys(qualities).length) return null
  const artist = s.artist ?? ''
  return {
    type: 'kw',
    id,
    title: name,
    artist,
    album: s.album ?? '',
    albumId: s.albumid != null ? String(s.albumid) : undefined,
    cover: s.albumPic ? String(s.albumPic).replace('albumcover/120', 'albumcover/500') : '',
    duration: num(s.duration, 0) * 1000,
    qualities,
    singers: splitSingers(
      String(artist),
      s.allartistid != null ? String(s.allartistid) : s.artistid
    )
  }
}
