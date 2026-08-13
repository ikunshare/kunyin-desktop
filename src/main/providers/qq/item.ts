/* eslint-disable @typescript-eslint/no-explicit-any */
/** QQ 音乐单曲解析与音质映射（移植自 QQMusicItem.kt） */
import type { QQMusicItem, Quality, Singer } from '@common'

export function num(v: any, def = 0): number {
  if (v == null) return def
  const n = Number(v)
  return Number.isFinite(n) ? n : def
}

export function stripEm(s: string): string {
  return String(s ?? '').replace(/<\/?em>/g, '')
}

function addQ(
  q: Record<string, Quality>,
  id: string,
  name: string,
  size: number,
  mediaInfo: string
): void {
  if (size > 0) q[id] = { id, name, filesize: size, mediaInfo }
}
function addSpecial(
  q: Record<string, Quality>,
  id: string,
  name: string,
  sizeNew: number[],
  si: number,
  vs: string[],
  vi: number
): void {
  const size = num(sizeNew[si], 0)
  const media = vs[vi]
  if (size > 0 && media) q[id] = { id, name, filesize: size, mediaInfo: media }
}

export function parseTrackInfo(item: any): QQMusicItem | null {
  if (!item) return null
  const id = num(item.id, 0)
  if (!id) return null
  const title = item.title ?? item.name
  if (!title) return null
  const file = item.file
  if (!file) return null // 无 file 视为本地歌曲

  const singerArr: any[] = Array.isArray(item.singer) ? item.singer : []
  const singers: Singer[] = singerArr
    .filter((s) => s?.name)
    .map((s) => ({
      name: s.name,
      headimg: s.mid
        ? `https://y.gtimg.cn/music/photo_new/T001R800x800M000${s.mid}.jpg`
        : undefined,
      singerId: num(s.id, 0),
      extra: s.mid
    }))
  const artist = singers.length ? singers.map((s) => s.name).join('、') : 'Unknown'

  const album = item.album ?? {}
  const albumMid = album.mid ?? ''
  const albumId = album.id && num(album.id, 0) !== 0 ? String(album.id) : albumMid
  const mediaMid = file.media_mid ?? ''
  const cover = albumMid
    ? `https://y.gtimg.cn/music/photo_new/T002R800x800M000${albumMid}.jpg`
    : (singers[0]?.headimg ?? '')

  const vs: string[] = Array.isArray(item.vs) ? item.vs : []
  const sizeNew: number[] = Array.isArray(file.size_new) ? file.size_new : []

  const q: Record<string, Quality> = {}
  addQ(q, '128k', '普通音质 128K', num(file.size_128mp3, 0), mediaMid)
  addQ(q, '320k', '高品音质 320K', num(file.size_320mp3, 0), mediaMid)
  addQ(q, 'flac', '无损音质 FLAC', num(file.size_flac, 0), mediaMid)
  addQ(q, 'hires', '无损音质 HiRes', num(file.size_hires, 0), mediaMid)
  addSpecial(q, 'master', '臻品母带', sizeNew, 0, vs, 3)
  addSpecial(q, 'atmos', '臻品全景声', sizeNew, 1, vs, 4)
  addSpecial(q, 'atmos_plus', '臻品全景声 2.0', sizeNew, 2, vs, 4)

  return {
    type: 'qq',
    id,
    title,
    artist,
    album: album.name ?? '',
    albumId,
    cover,
    duration: num(item.interval, 0) * 1000,
    qualities: q,
    mid: item.mid ?? '',
    albumMid,
    mediaMid,
    vs,
    sizeNew,
    singers: singers.length ? singers : undefined,
    mvid: item.mv?.vid ? String(item.mv.vid) : undefined
  }
}
