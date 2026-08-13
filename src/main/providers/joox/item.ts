/* eslint-disable @typescript-eslint/no-explicit-any */
/** JOOX 单曲解析（songname/albumname/singername 为 base64；kbps_map 为 JSON 字符串） */
import type { JooxMusicItem, Quality } from '@common'

export function num(v: any, def = 0): number {
  if (v == null) return def
  const n = Number(v)
  return Number.isFinite(n) ? n : def
}

function decodeB64(s: string): string {
  if (!s) return ''
  try {
    // 注：JOOX 返回繁体，此处未做繁→简转换（可后续接 OpenCC）
    return Buffer.from(s, 'base64').toString('utf-8')
  } catch {
    return s
  }
}

const JOOX_QUALITY: Record<string, [string, string]> = {
  '128': ['128k', '普通音质 128K'],
  '320': ['320k', '高品音质 320K'],
  flac: ['flac', '无损音质 FLAC'],
  hires: ['hires', '无损音质 HiRes'],
  master_tape: ['master', '臻品母带'],
  stereo_atmos: ['atmos', '臻品全景声']
}

export function parseSongInfo(si: any): JooxMusicItem | null {
  if (!si) return null
  const id = num(si.songid, 0)
  if (!id) return null
  const mid = si.songmid
  if (!mid) return null

  const singerNames: string[] = (Array.isArray(si.singerInfo) ? si.singerInfo : [])
    .map((s: any) => decodeB64(s?.singername))
    .filter((x: string) => x)
  // 源码：有 singerInfo 则拼接，否则回退 decodeB64(singername)（可能为空串，不兜 'Unknown'）
  const artist = singerNames.length ? singerNames.join('、') : decodeB64(si.singername)

  const q: Record<string, Quality> = {}
  let kbps: any = {}
  try {
    kbps = JSON.parse(si.kbps_map ?? '{}')
  } catch {
    kbps = {}
  }
  for (const [apiKey, [qid, qname]] of Object.entries(JOOX_QUALITY)) {
    const size = num(kbps[apiKey], 0)
    if (size > 0) q[qid] = { id: qid, name: qname, filesize: size }
  }

  return {
    type: 'joox',
    id,
    title: decodeB64(si.songname),
    artist,
    album: decodeB64(si.albumname),
    cover: si.album_url ?? '',
    duration: num(si.playtime, 0) * 1000,
    qualities: q,
    mid
    // 源码构造 JooxMusicItem 时未设 singers（默认 null），此处不捏造
  }
}
