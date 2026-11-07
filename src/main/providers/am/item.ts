/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  qualityName,
  type AlbumInfoResult,
  type AppleMusicItem,
  type ArtistInfoResult,
  type Quality,
  type Singer
} from '@common'

function num(value: unknown, fallback = 0): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function text(value: unknown): string {
  return value == null ? '' : String(value)
}

export function durationMs(value: unknown): number {
  if (typeof value === 'string' && value.includes(':')) {
    const parts = value.split(':').map(Number)
    if (parts.some((n) => !Number.isFinite(n))) return 0
    return Math.round(parts.reduce((seconds, part) => seconds * 60 + part, 0) * 1000)
  }
  const n = num(value)
  return Math.round(n > 1000 ? n : n * 1000)
}

export function parseAppleSong(raw: any): AppleMusicItem | null {
  if (!raw) return null
  const id = num(raw.songId ?? raw.id)
  const title = text(raw.songName ?? raw.name ?? raw.title)
  if (id <= 0 || !title) return null
  const singers: Singer[] = (Array.isArray(raw.artists) ? raw.artists : [])
    .filter((artist: any) => artist?.name)
    .map((artist: any) => ({
      name: text(artist.name),
      singerId: num(artist.id),
      headimg: artist.cover || undefined
    }))
  const qualities: Record<string, Quality> = {}
  const sourceQualities = raw.quality && typeof raw.quality === 'object' ? raw.quality : {}
  for (const id of Object.keys(sourceQualities)) {
    const value = sourceQualities[id]
    qualities[id] = {
      id,
      name: qualityName(id, 'am'),
      filesize: num(value?.filesize ?? value, 0),
      bitrate: num(value?.bitrate, 0) || undefined
    }
  }
  if (Object.keys(qualities).length === 0) {
    qualities['320k'] = { id: '320k', name: qualityName('320k', 'am'), filesize: 0 }
  }
  const albumId = raw.albumId != null && raw.albumId !== '' ? String(raw.albumId) : undefined
  return {
    type: 'am',
    id,
    title,
    artist: text(raw.artistName ?? raw.artist) || singers.map((s) => s.name).join('、'),
    album: text(raw.albumName ?? raw.album),
    albumId,
    cover: text(raw.coverUrl ?? raw.cover),
    duration: durationMs(raw.duration ?? raw.durationInMillis),
    qualities,
    singers: singers.length ? singers : undefined,
    previewUrl: text(raw.previewUrl) || undefined
  }
}

export function parseAppleAlbum(raw: any): AlbumInfoResult | null {
  if (!raw?.id || !raw?.name) return null
  return {
    source: 'am',
    id: String(raw.id),
    name: text(raw.name),
    cover: text(raw.coverUrl ?? raw.cover) || undefined,
    artist: text(raw.artistName ?? raw.artist) || undefined,
    artistId: raw.artistId != null ? String(raw.artistId) : undefined,
    publishTime: text(raw.publishTime ?? raw.releaseDate) || undefined,
    description: text(raw.description) || undefined,
    company: text(raw.company ?? raw.recordLabel) || undefined,
    total: num(raw.total ?? raw.trackCount),
    subType: text(raw.subType) || undefined
  }
}

export function parseAppleArtist(raw: any): ArtistInfoResult | null {
  if (!raw?.id || !raw?.name) return null
  return {
    source: 'am',
    id: String(raw.id),
    name: text(raw.name),
    cover: text(raw.coverUrl ?? raw.cover) || undefined,
    description: text(raw.description) || undefined,
    songCount: num(raw.songCount),
    albumCount: num(raw.albumCount)
  }
}
