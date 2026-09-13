/**
 * 平台歌单缓存（对应 Android database/PlatformPlaylistStore.kt）。
 *
 * 登录平台的用户信息、「我的歌单」列表、以及已整单拉取过的曲目，按 source 落到
 * `data/platform_playlists.json`：列表页先显示缓存再后台刷新，账号页显示昵称也不必现打接口。
 * 这只是远端数据的本地镜像，与 SQLite 曲库无关，登出即清。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import type { MusicItem, PlayListInfoResult, UserInfo } from '@common'
import { appDataPath } from '../core/paths'

interface PlatformCache {
  users: Record<string, UserInfo>
  playlists: Record<string, PlayListInfoResult[]>
  /** `${source}_${playlistId}` → 歌单信息 */
  infos: Record<string, PlayListInfoResult>
  /** `${source}_${playlistId}` → 完整曲目（只在整单拉完后写入） */
  songs: Record<string, MusicItem[]>
}

let cache: PlatformCache | null = null

function filePath(): string {
  return appDataPath('platform_playlists.json')
}

function emptyCache(): PlatformCache {
  return { users: {}, playlists: {}, infos: {}, songs: {} }
}

function load(): PlatformCache {
  try {
    const raw = JSON.parse(readFileSync(filePath(), 'utf-8')) as Partial<PlatformCache>
    return { ...emptyCache(), ...raw }
  } catch {
    return emptyCache()
  }
}

function data(): PlatformCache {
  return (cache ??= load())
}

function persist(): void {
  const path = filePath()
  const dir = appDataPath()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const tmp = `${path}.tmp`
  writeFileSync(tmp, JSON.stringify(data()), 'utf-8')
  renameSync(tmp, path)
}

const songKey = (source: string, playlistId: string): string => `${source}_${playlistId}`

export function saveUserInfo(source: string, info: UserInfo): void {
  data().users[source] = info
  persist()
}

export function getUserInfo(source: string): UserInfo | null {
  return data().users[source] ?? null
}

export function savePlaylists(source: string, playlists: PlayListInfoResult[]): void {
  data().playlists[source] = playlists
  persist()
}

export function getPlaylists(source: string): PlayListInfoResult[] {
  return data().playlists[source] ?? []
}

export function saveSongs(source: string, playlistId: string, songs: MusicItem[]): void {
  data().songs[songKey(source, playlistId)] = songs
  persist()
}

export function getSongs(source: string, playlistId: string): MusicItem[] | null {
  return data().songs[songKey(source, playlistId)] ?? null
}

export function savePlaylistInfo(
  source: string,
  playlistId: string,
  info: PlayListInfoResult
): void {
  data().infos[songKey(source, playlistId)] = info
  persist()
}

export function getPlaylistInfo(source: string, playlistId: string): PlayListInfoResult | null {
  return data().infos[songKey(source, playlistId)] ?? null
}

/** 丢掉某个歌单已缓存的曲目与信息（歌单内容变了） */
export function clearPlaylistSongs(source: string, playlistId: string): void {
  const d = data()
  const k = songKey(source, playlistId)
  if (!(k in d.songs) && !(k in d.infos)) return
  delete d.songs[k]
  delete d.infos[k]
  persist()
}

/** 丢掉某平台全部曲目缓存（保留用户信息与歌单列表） */
export function clearSongs(source: string): void {
  const d = data()
  const prefix = `${source}_`
  for (const k of Object.keys(d.songs)) if (k.startsWith(prefix)) delete d.songs[k]
  persist()
}

/** 登出：该平台的一切缓存全清 */
export function clearPlatform(source: string): void {
  const d = data()
  delete d.users[source]
  delete d.playlists[source]
  const prefix = `${source}_`
  for (const k of Object.keys(d.songs)) if (k.startsWith(prefix)) delete d.songs[k]
  for (const k of Object.keys(d.infos)) if (k.startsWith(prefix)) delete d.infos[k]
  persist()
}
