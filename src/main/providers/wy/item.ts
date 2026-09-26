/* eslint-disable @typescript-eslint/no-explicit-any */
/** 网易云单曲解析与音质映射（移植自 NeteaseMusicItem.kt） */
import { qualityName, type NeteaseMusicItem, type Quality, type Singer } from '@common'

export function num(v: any, def = 0): number {
  if (v == null) return def
  const n = Number(v)
  return Number.isFinite(n) ? n : def
}

function addQuality(q: Record<string, Quality>, id: string, name: string, obj: any): void {
  const size = num(obj?.size, 0)
  if (size > 0) q[id] = { id, name, filesize: size }
}

export function parseTrackInfo(song: any): NeteaseMusicItem | null {
  if (!song) return null
  const id = num(song.id, -1)
  if (id === -1) return null
  const name = song.name
  if (!name) return null

  const ar: any[] = Array.isArray(song.ar) ? song.ar : []
  const singers: Singer[] = ar
    .filter((a) => a?.name)
    .map((a) => ({ name: a.name, headimg: a.picUrl ?? undefined, singerId: num(a.id, 0) }))
  const artist = singers.length ? singers.map((s) => s.name).join('、') : 'Unknown'

  const al = song.al ?? {}
  const mv = num(song.mv, 0)

  const q: Record<string, Quality> = {}
  addQuality(q, '128k', '普通音质 128K', song.l)
  addQuality(q, '320k', '高品音质 320K', song.h)
  addQuality(q, 'flac', '无损音质 FLAC', song.sq)
  addQuality(q, 'hires', '无损音质 HiRes', song.hr)

  return {
    type: 'wy',
    id,
    title: name,
    artist,
    album: al.name ?? '',
    albumId: al.id != null ? String(al.id) : undefined,
    cover: al.picUrl ?? '',
    duration: num(song.dt, 0),
    qualities: q,
    singers: singers.length ? singers : undefined,
    mvid: mv === 0 ? undefined : String(mv)
  }
}

/**
 * 与后端请求一致的沉浸环绕声版本（immerseType=c51，5.1 声道 FLAC）。
 * `sks` 里是各版本（`it` 为类型），`sk` 只是上游默认那一版；取不到 c51 才退回 `sk`。
 * 后端的对应常量是 ikun-music-api-server 的 skyImmerseType，改一边要同步另一边。
 */
const SKY_IMMERSE_TYPE = 'c51'
function skyQuality(data: any): any {
  const sks: any[] = Array.isArray(data.sks) ? data.sks : []
  return sks.find((s) => s?.it === SKY_IMMERSE_TYPE) ?? data.sk
}

export function enrichFromQualityDetail(item: NeteaseMusicItem, response: any): NeteaseMusicItem {
  const data = response?.data
  if (!data) return item
  const q: Record<string, Quality> = { ...item.qualities }
  addQuality(q, 'master', qualityName('master', 'wy'), data.jm)
  addQuality(q, 'atmos', qualityName('atmos', 'wy'), skyQuality(data))
  addQuality(q, 'atmos_plus', qualityName('atmos_plus', 'wy'), data.je)
  addQuality(q, 'dolby', qualityName('dolby', 'wy'), data.db)
  addQuality(q, 'vivid', qualityName('vivid', 'wy'), data.vi)
  if (Object.keys(q).length === Object.keys(item.qualities).length) return item
  return { ...item, qualities: q }
}
