/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * LX Music 歌曲/歌单同步 JSON 编解码（1:1 移植 Android sync/LxCodec.kt）。与 .lxmc 导入/导出同源。
 * LX source `tx` ↔ 本项目 `qq`；`kg`/`wy`/`kw` 直通。解码缺字段返回 null，调用方需过滤。
 */
import type {
  KugouMusicItem,
  KuwoMusicItem,
  MusicItem,
  NeteaseMusicItem,
  QQMusicItem,
  Quality
} from '@common'

type Json = Record<string, any>

// ─────────────── 解码（LX → MusicItem）───────────────

export function songFromJson(o: Json): MusicItem | null {
  const source = str(o.source)
  const title = str(o.name)
  if (!source || title == null) return null
  const artist = str(o.singer) ?? 'Unknown'
  const duration = parseInterval(str(o.interval))
  const meta = o.meta
  if (!meta || typeof meta !== 'object') return null
  switch (source) {
    case 'tx':
      return buildTx(meta, title, artist, duration)
    case 'kg':
      return buildKg(meta, title, artist, duration)
    case 'wy':
      return buildWy(meta, title, artist, duration)
    case 'kw':
      return buildKw(meta, title, artist, duration)
    default:
      return null
  }
}

function buildTx(m: Json, title: string, artist: string, duration: number): QQMusicItem | null {
  const id = asLong(m.id)
  if (id == null) return null
  const mid = str(m.songId) ?? ''
  const albumMid = str(m.albumMid) ?? ''
  const mediaMid = str(m.strMediaMid) ?? ''
  return {
    type: 'qq',
    id,
    title,
    artist,
    album: str(m.albumName) ?? '',
    cover: str(m.picUrl) ?? '',
    duration,
    qualities: parseTxQualities(m, mediaMid),
    mid,
    albumMid,
    mediaMid,
    vs: [],
    sizeNew: [],
    albumId: asIdString(m.albumId)
  }
}

function buildKg(m: Json, title: string, artist: string, duration: number): KugouMusicItem | null {
  const id = asLong(m.songId)
  if (id == null) return null
  const qs: Json | undefined = m._qualitys
  const baseHash =
    strNonBlank(m.hash) ?? (qs?.['128k'] ? str(qs['128k'].hash) : undefined) ?? undefined
  if (!baseHash) return null
  const allHashes = new Set<string>()
  if (qs) {
    for (const v of Object.values(qs)) {
      const h = str((v as Json)?.hash)
      if (h) allHashes.add(h)
    }
  }
  allHashes.add(baseHash)
  return {
    type: 'kg',
    id,
    title,
    artist,
    album: str(m.albumName) ?? '',
    cover: str(m.picUrl) ?? '',
    duration,
    qualities: parseKgQualities(qs),
    mixsongmid: 0,
    hash: baseHash,
    allHash: Array.from(allHashes),
    audioId: '',
    albumId: asIdString(m.albumId)
  }
}

function buildWy(
  m: Json,
  title: string,
  artist: string,
  duration: number
): NeteaseMusicItem | null {
  const id = asLong(m.songId)
  if (id == null) return null
  return {
    type: 'wy',
    id,
    title,
    artist,
    album: str(m.albumName) ?? '',
    cover: str(m.picUrl) ?? '',
    duration,
    qualities: parseStdQualities(m._qualitys),
    albumId: asIdString(m.albumId)
  }
}

function buildKw(m: Json, title: string, artist: string, duration: number): KuwoMusicItem | null {
  const id = asLong(m.songId)
  if (id == null) return null
  return {
    type: 'kw',
    id,
    title,
    artist,
    album: str(m.albumName) ?? '',
    cover: str(m.picUrl) ?? '',
    duration,
    qualities: parseStdQualities(m._qualitys),
    albumId: asIdString(m.albumId)
  }
}

function parseTxQualities(m: Json, mediaMid: string): Record<string, Quality> {
  const out: Record<string, Quality> = {}
  const qs: Json | undefined = m._qualitys
  if (!qs) return out
  for (const [k, v] of Object.entries(qs)) {
    const obj = v as Json
    if (!obj || typeof obj !== 'object') continue
    const disp = str(obj.size)
    const sz = disp ? parseSizeString(disp) : 0
    const mk = (id: string, name: string): void => {
      out[id] = { id, name, filesize: sz, mediaInfo: mediaMid, displaySize: disp ?? undefined }
    }
    switch (k) {
      case '128k':
        mk('128k', '普通音质 128K')
        break
      case '320k':
        mk('320k', '高品音质 320K')
        break
      case 'flac':
        mk('flac', '无损音质 FLAC')
        break
      case 'flac24bit':
      case 'hires':
        mk('hires', '无损音质 HiRes')
        break
      case 'master':
        mk('master', '臻品母带')
        break
      case 'atmos':
        mk('atmos', '臻品全景声')
        break
      case 'atmos_plus':
        mk('atmos_plus', '臻品全景声 2.0')
        break
    }
  }
  return out
}

function parseKgQualities(qs: Json | undefined): Record<string, Quality> {
  const out: Record<string, Quality> = {}
  if (!qs) return out
  for (const [k, v] of Object.entries(qs)) {
    const obj = v as Json
    if (!obj || typeof obj !== 'object') continue
    const disp = str(obj.size)
    const sz = disp ? parseSizeString(disp) : 0
    const mk = (id: string, name: string, bitrate?: number): void => {
      out[id] = { id, name, filesize: sz, bitrate, displaySize: disp ?? undefined }
    }
    switch (k) {
      case '128k':
        mk('128k', '普通音质 128K', 128)
        break
      case '320k':
        mk('320k', '高品音质 320K', 320)
        break
      case 'flac':
        mk('flac', '无损音质 FLAC', 2000)
        break
      case 'hires':
      case 'flac24bit':
        mk('hires', '无损音质 HiRes', 4000)
        break
      case 'atmos':
        mk('atmos', '臻品全景声')
        break
      case 'atmos_plus':
        mk('atmos_plus', '臻品全景声 2.0')
        break
      case 'master':
        mk('master', '臻品母带', 20900)
        break
    }
  }
  return out
}

function parseStdQualities(qs: Json | undefined): Record<string, Quality> {
  const out: Record<string, Quality> = {}
  if (!qs) return out
  for (const [k, v] of Object.entries(qs)) {
    const obj = v as Json
    if (!obj || typeof obj !== 'object') continue
    const disp = str(obj.size)
    const sz = disp ? parseSizeString(disp) : 0
    const mk = (id: string, name: string): void => {
      out[id] = { id, name, filesize: sz, displaySize: disp ?? undefined }
    }
    switch (k) {
      case '128k':
        mk('128k', '普通音质 128K')
        break
      case '320k':
        mk('320k', '高品音质 320K')
        break
      case 'flac':
        mk('flac', '无损音质 FLAC')
        break
      case 'hires':
      case 'flac24bit':
        mk('hires', '无损音质 HiRes')
        break
      case 'master':
        mk('master', '臻品母带')
        break
      case 'atmos':
        mk('atmos', '臻品全景声')
        break
      case 'atmos_plus':
        mk('atmos_plus', '臻品全景声 2.0')
        break
    }
  }
  return out
}

function parseSizeString(s: string): number {
  const m = /([0-9]+(?:\.[0-9]+)?)\s*([a-zA-Z]+)?/.exec(s.trim())
  if (!m) return 0
  const num = Number(m[1])
  if (!Number.isFinite(num)) return 0
  const unit = (m[2] ?? '').toUpperCase()
  const mul = unit === 'KB' ? 1024 : unit === 'MB' ? 1024 * 1024 : unit === 'GB' ? 1024 ** 3 : 1
  return Math.trunc(num * mul)
}

function parseInterval(s: string | null | undefined): number {
  if (!s) return 0
  const parts = s.split(':')
  if (parts.length === 2) {
    return (Number(parts[0]) || 0) * 60_000 + (Number(parts[1]) || 0) * 1000
  }
  if (parts.length === 3) {
    return (
      ((Number(parts[0]) || 0) * 3600 + (Number(parts[1]) || 0) * 60 + (Number(parts[2]) || 0)) *
      1000
    )
  }
  return 0
}

// ─────────────── 编码（MusicItem → LX）───────────────

export function songToJson(item: MusicItem): Json {
  switch (item.type) {
    case 'qq':
      return txToJson(item)
    case 'kg':
      return kgToJson(item)
    case 'wy':
      return wyToJson(item)
    case 'kw':
      return kwToJson(item)
    default:
      return {}
  }
}

function baseSong(
  id: string,
  title: string,
  artist: string,
  duration: number,
  source: string
): Json {
  return { id, name: title, singer: artist, source, interval: formatInterval(duration) }
}

function formatInterval(durationMs: number): string {
  const s = Math.trunc(durationMs / 1000)
  const mm = Math.trunc(s / 60)
  const ss = s % 60
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
}

function txToJson(it: QQMusicItem): Json {
  const lxId = `tx_${it.mid || String(it.id)}`
  const root = baseSong(lxId, it.title, it.artist, it.duration, 'tx')
  const meta: Json = {
    songId: it.mid,
    strMediaMid: it.mediaMid,
    albumMid: it.albumMid,
    albumName: it.album,
    id: it.id,
    picUrl: it.cover,
    _qualitys: txQualitiesJson(it.qualities),
    qualitys: txQualityListJson(it.qualities)
  }
  if (it.albumId) meta.albumId = it.albumId
  root.meta = meta
  return root
}

function kgToJson(it: KugouMusicItem): Json {
  const lxId = `${it.id}_${it.hash}`
  const root = baseSong(lxId, it.title, it.artist, it.duration, 'kg')
  const meta: Json = {
    songId: it.id,
    hash: it.hash,
    albumName: it.album,
    picUrl: it.cover,
    _qualitys: kgQualitiesJson(it.qualities),
    qualitys: kgQualityListJson(it.qualities)
  }
  if (it.albumId) meta.albumId = it.albumId
  root.meta = meta
  return root
}

function wyToJson(it: NeteaseMusicItem): Json {
  const root = baseSong(`wy_${it.id}`, it.title, it.artist, it.duration, 'wy')
  const meta: Json = {
    songId: it.id,
    albumName: it.album,
    picUrl: it.cover,
    _qualitys: stdQualitiesJson(it.qualities),
    qualitys: stdQualityListJson(it.qualities)
  }
  if (it.albumId) meta.albumId = it.albumId
  root.meta = meta
  return root
}

function kwToJson(it: KuwoMusicItem): Json {
  const root = baseSong(`kw_${it.id}`, it.title, it.artist, it.duration, 'kw')
  const meta: Json = {
    songId: it.id,
    albumName: it.album,
    picUrl: it.cover,
    _qualitys: stdQualitiesJson(it.qualities),
    qualitys: stdQualityListJson(it.qualities)
  }
  if (it.albumId) meta.albumId = it.albumId
  root.meta = meta
  return root
}

function sizeLabel(bytes: number): string | null {
  if (bytes <= 0) return null
  const mb = bytes / (1024 * 1024)
  const kb = bytes / 1024
  return mb >= 1 ? `${mb.toFixed(2)} MB` : `${kb.toFixed(2)} KB`
}

function eachQuality(
  qs: Record<string, Quality>,
  fn: (id: string, q: Quality, disp: string) => void
): void {
  for (const [id, q] of Object.entries(qs)) {
    const disp = q.displaySize ?? sizeLabel(q.filesize)
    if (!disp) continue
    fn(id, q, disp)
  }
}

function txQualitiesJson(qs: Record<string, Quality>): Json {
  const out: Json = {}
  eachQuality(qs, (id, _q, disp) => {
    const k = id === 'hires' ? 'flac24bit' : id
    out[k] = { size: disp }
  })
  return out
}
function txQualityListJson(qs: Record<string, Quality>): Json[] {
  const arr: Json[] = []
  eachQuality(qs, (id, _q, disp) => {
    const k = id === 'hires' ? 'flac24bit' : id
    arr.push({ size: disp, type: k })
  })
  return arr
}

function kgQualitiesJson(qs: Record<string, Quality>): Json {
  const out: Json = {}
  eachQuality(qs, (id, q, disp) => {
    const obj: Json = { size: disp }
    if (q.mediaInfo) obj.hash = q.mediaInfo
    out[id] = obj
  })
  return out
}
function kgQualityListJson(qs: Record<string, Quality>): Json[] {
  const arr: Json[] = []
  eachQuality(qs, (id, q, disp) => {
    const obj: Json = { size: disp, type: id }
    if (q.mediaInfo) obj.hash = q.mediaInfo
    arr.push(obj)
  })
  return arr
}

function stdQualitiesJson(qs: Record<string, Quality>): Json {
  const out: Json = {}
  eachQuality(qs, (id, _q, disp) => {
    const k = id === 'hires' ? 'flac24bit' : id
    out[k] = { size: disp }
  })
  return out
}
function stdQualityListJson(qs: Record<string, Quality>): Json[] {
  const arr: Json[] = []
  eachQuality(qs, (id, _q, disp) => {
    const k = id === 'hires' ? 'flac24bit' : id
    arr.push({ size: disp, type: k })
  })
  return arr
}

// ─────────────── helpers ───────────────

function str(v: unknown): string | null {
  if (v == null) return null
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return null
}
function strNonBlank(v: unknown): string | undefined {
  const s = str(v)
  return s && s.trim() ? s : undefined
}
function asLong(v: unknown): number | null {
  if (v == null) return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? Math.trunc(n) : null
}
/** 数字 → 非"0"字符串，字符串 → 非空，否则 undefined（对应 Kotlin asString）。 */
function asIdString(v: unknown): string | undefined {
  if (v == null) return undefined
  if (typeof v === 'number') {
    const s = String(Math.trunc(v))
    return s !== '0' ? s : undefined
  }
  if (typeof v === 'string') return v.trim() ? v : undefined
  return undefined
}
