/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 备份 / 导入（对应 Android manager/BackupManager.kt + LxMusicImporter.kt）。
 * - 完整备份：settings + favorites + playlists + trial（歌曲以 song_json 存，跨设备通用）。
 * - LX 导入：解析 playList_v2 / playListPart_v2（支持 gzip .lxmc），复用 sync/codec.songFromJson。
 * 落地统一走 library.ts 的 *Direct 无副作用变体，最后 refreshAfterRestore。
 */
import { IpcChannels, type AppSettings, type MusicItem } from '@common'
import { dialog } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { getMainWindow } from '../../windows/main'
import { handle } from '../../ipc/helpers'
import { getSettings, updateSettings } from '../../store/settings'
import * as store from '../../store/library'
import { songFromJson } from '../sync/codec'

const BACKUP_VERSION = 1

// ─── 备份数据结构（与 Android 段名对齐，settings 存桌面 AppSettings 整体）───

interface SongEntry {
  song_json: string
  added_at: number
}
interface PlaylistSongEntry extends SongEntry {
  position: number
}
interface PlaylistEntry {
  name: string
  created_at: number
  songs: PlaylistSongEntry[]
}
interface BackupRoot {
  version: number
  type: 'full' | 'playlists_only'
  created_at: number
  settings?: AppSettings
  favorites?: SongEntry[]
  playlists?: PlaylistEntry[]
  trial?: PlaylistSongEntry[]
}

export interface BackupSummary {
  version: number
  type: string
  createdAt: number
  hasSettings: boolean
  favoritesCount: number
  playlistsCount: number
  trialCount: number
}
export interface RestoreOptions {
  restoreSettings: boolean
  restorePlaylists: boolean
}
export interface RestoreResult {
  favoritesAdded: number
  favoritesSkipped: number
  playlistsCreated: number
  songsAdded: number
  songsSkipped: number
  settingsRestored: boolean
}

export interface LxImportResult {
  favoritesAdded: number
  trialAdded: number
  playlistsCreated: number
  songsAdded: number
  songsSkipped: number
}

// ─── 备份导出 ───

function serializeFavorites(): SongEntry[] {
  const favPid = store.getFavoritesPlaylistId()
  if (favPid <= 0) return []
  return store.queryPlaylistSongsRaw(favPid).map((r) => ({
    song_json: r.songJson,
    added_at: r.addedAt
  }))
}

function serializePlaylists(ids: number[] | null): PlaylistEntry[] {
  const out: PlaylistEntry[] = []
  for (const pl of store.getPlaylists()) {
    if (pl.isSystem) continue
    if (ids && !ids.includes(pl.id)) continue
    const songs = store.queryPlaylistSongsRaw(pl.id).map((r) => ({
      song_json: r.songJson,
      added_at: r.addedAt,
      position: r.position
    }))
    out.push({ name: pl.name, created_at: pl.createdAt, songs })
  }
  return out
}

function serializeTrial(): PlaylistSongEntry[] {
  const trialId = store.getTrialPlaylistId()
  if (trialId <= 0) return []
  return store.queryPlaylistSongsRaw(trialId).map((r) => ({
    song_json: r.songJson,
    added_at: r.addedAt,
    position: r.position
  }))
}

export function exportFull(filePath: string): void {
  const root: BackupRoot = {
    version: BACKUP_VERSION,
    type: 'full',
    created_at: Date.now(),
    settings: getSettings(),
    favorites: serializeFavorites(),
    playlists: serializePlaylists(null),
    trial: serializeTrial()
  }
  writeFileSync(filePath, JSON.stringify(root))
}

export function exportPlaylists(
  filePath: string,
  opts: { includeFavorites: boolean; includeTrial: boolean; playlistIds: number[] }
): void {
  const root: BackupRoot = {
    version: BACKUP_VERSION,
    type: 'playlists_only',
    created_at: Date.now(),
    playlists: serializePlaylists(opts.playlistIds.length ? opts.playlistIds : null)
  }
  if (opts.includeFavorites) root.favorites = serializeFavorites()
  if (opts.includeTrial) root.trial = serializeTrial()
  writeFileSync(filePath, JSON.stringify(root))
}

// ─── 备份解析 / 恢复 ───

function parseBackupFile(filePath: string): BackupRoot {
  const text = readFileSync(filePath, 'utf-8')
  const root = JSON.parse(text) as BackupRoot
  if ((root.version ?? 0) < 1) throw new Error('unsupported_version')
  return root
}

export function parseBackup(filePath: string): BackupSummary {
  const root = parseBackupFile(filePath)
  return {
    version: root.version,
    type: root.type ?? 'full',
    createdAt: root.created_at ?? 0,
    hasSettings: !!root.settings,
    favoritesCount: root.favorites?.length ?? 0,
    playlistsCount: root.playlists?.length ?? 0,
    trialCount: root.trial?.length ?? 0
  }
}

export function restoreBackup(filePath: string, options: RestoreOptions): RestoreResult {
  const root = parseBackupFile(filePath)
  const result: RestoreResult = {
    favoritesAdded: 0,
    favoritesSkipped: 0,
    playlistsCreated: 0,
    songsAdded: 0,
    songsSkipped: 0,
    settingsRestored: false
  }

  if (options.restoreSettings && root.settings) {
    updateSettings(root.settings)
    result.settingsRestored = true
  }

  if (options.restorePlaylists) {
    const favPid = store.getFavoritesPlaylistId()
    for (const entry of root.favorites ?? []) {
      const item = safeParse(entry.song_json)
      if (!item) {
        result.songsSkipped++
        continue
      }
      if (store.isFavorite(item)) {
        result.favoritesSkipped++
      } else if (favPid > 0) {
        store.appendSongDirect(favPid, entry.song_json, entry.added_at)
        result.favoritesAdded++
      }
    }

    for (const pl of root.playlists ?? []) {
      const newPid = store.createPlaylistDirect(pl.name, pl.created_at)
      if (newPid <= 0) continue
      result.playlistsCreated++
      for (const song of pl.songs) {
        store.addToPlaylistDirect(newPid, song.song_json, song.added_at, song.position)
        result.songsAdded++
      }
    }

    const trialId = store.getTrialPlaylistId()
    if (trialId > 0) {
      for (const song of root.trial ?? []) {
        store.addToPlaylistDirect(trialId, song.song_json, song.added_at, song.position)
        result.songsAdded++
      }
    }

    store.refreshAfterRestore()
  }

  return result
}

// ─── LX Music 导入（.lxmc / playList_v2 / playListPart_v2）───

interface LxPlaylist {
  systemKind: 'trial' | 'favorites' | null
  displayName: string
  songs: MusicItem[]
}

export interface LxImportSummary {
  playlistsCount: number
  songsCount: number
  detail: string
}

function decompressIfGzip(bytes: Buffer): Buffer {
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) return gunzipSync(bytes)
  return bytes
}

function parseLxPlaylists(filePath: string): LxPlaylist[] | null {
  const raw = readFileSync(filePath)
  const text = decompressIfGzip(raw).toString('utf-8').trim()
  let root: any
  try {
    root = JSON.parse(text)
  } catch {
    return null
  }
  const type = root?.type
  let arr: any[]
  if (type === 'playList_v2') {
    if (!Array.isArray(root.data)) return null
    arr = root.data
  } else if (type === 'playListPart_v2') {
    const d = root.data
    if (d && typeof d === 'object' && !Array.isArray(d)) arr = [d]
    else if (Array.isArray(d)) arr = d
    else return null
  } else {
    return null
  }

  const lists: LxPlaylist[] = []
  for (const pl of arr) {
    if (!pl || typeof pl !== 'object') continue
    const id = typeof pl.id === 'string' ? pl.id : undefined
    if (!id) continue
    const rawName = typeof pl.name === 'string' ? pl.name : id
    const songs: MusicItem[] = []
    for (const sEl of Array.isArray(pl.list) ? pl.list : []) {
      if (sEl && typeof sEl === 'object') {
        const item = songFromJson(sEl)
        if (item) songs.push(item)
      }
    }
    const systemKind: 'trial' | 'favorites' | null =
      id === 'default' ? 'trial' : id === 'love' ? 'favorites' : null
    const displayName =
      systemKind === 'trial'
        ? '试听列表'
        : systemKind === 'favorites'
          ? '我的收藏'
          : rawName === 'list__name_default'
            ? '试听列表'
            : rawName === 'list__name_love'
              ? '我的收藏'
              : rawName
    lists.push({ systemKind, displayName, songs })
  }
  return lists.length ? lists : null
}

export function parseLx(filePath: string): LxImportSummary | null {
  const lists = parseLxPlaylists(filePath)
  if (!lists) return null
  const songsCount = lists.reduce((a, l) => a + l.songs.length, 0)
  const detail = lists.map((l) => `${l.displayName}(${l.songs.length})`).join('、')
  return { playlistsCount: lists.length, songsCount, detail }
}

function keyOf(i: MusicItem): string {
  return `${i.id}_${i.type}`
}

export function importLx(filePath: string): LxImportResult | null {
  const lists = parseLxPlaylists(filePath)
  if (!lists) return null
  const result: LxImportResult = {
    favoritesAdded: 0,
    trialAdded: 0,
    playlistsCreated: 0,
    songsAdded: 0,
    songsSkipped: 0
  }
  const now = Date.now()

  for (const pl of lists) {
    if (pl.systemKind === 'trial') {
      const pid = store.getTrialPlaylistId()
      if (pid <= 0) {
        result.songsSkipped += pl.songs.length
        continue
      }
      const existing = new Set(store.queryPlaylistSongs(pid).map(keyOf))
      let pos = existing.size
      pl.songs.forEach((song, idx) => {
        const k = keyOf(song)
        if (existing.has(k)) {
          result.songsSkipped++
          return
        }
        store.addToPlaylistDirect(pid, JSON.stringify(song), now + idx, pos++)
        existing.add(k)
        result.trialAdded++
        result.songsAdded++
      })
    } else if (pl.systemKind === 'favorites') {
      const pid = store.getFavoritesPlaylistId()
      if (pid <= 0) {
        result.songsSkipped += pl.songs.length
        continue
      }
      const existing = new Set(store.queryPlaylistSongs(pid).map(keyOf))
      pl.songs.forEach((song, idx) => {
        const k = keyOf(song)
        if (existing.has(k)) {
          result.songsSkipped++
          return
        }
        store.appendSongDirect(pid, JSON.stringify(song), now + idx)
        existing.add(k)
        result.favoritesAdded++
        result.songsAdded++
      })
    } else {
      const newPid = store.createPlaylistDirect(pl.displayName, now)
      if (newPid <= 0) {
        result.songsSkipped += pl.songs.length
        continue
      }
      result.playlistsCreated++
      pl.songs.forEach((song, idx) => {
        store.addToPlaylistDirect(newPid, JSON.stringify(song), now + idx, idx)
        result.songsAdded++
      })
    }
  }

  store.refreshAfterRestore()
  return result
}

function safeParse(json: string): MusicItem | null {
  try {
    return JSON.parse(json) as MusicItem
  } catch {
    return null
  }
}

// ─── IPC ───

export function registerBackupHandlers(): void {
  handle(IpcChannels.BACKUP_EXPORT_FULL, (filePath: string) => exportFull(filePath))
  handle(
    IpcChannels.BACKUP_EXPORT_PLAYLISTS,
    (
      filePath: string,
      opts: { includeFavorites: boolean; includeTrial: boolean; playlistIds: number[] }
    ) => exportPlaylists(filePath, opts)
  )
  handle(IpcChannels.BACKUP_PARSE, (filePath: string) => parseBackup(filePath))
  handle(IpcChannels.BACKUP_RESTORE, (filePath: string, options: RestoreOptions) =>
    restoreBackup(filePath, options)
  )
  handle(IpcChannels.BACKUP_LX_PARSE, (filePath: string) => parseLx(filePath))
  handle(IpcChannels.BACKUP_LX_IMPORT, (filePath: string) => importLx(filePath))

  handle(IpcChannels.BACKUP_PICK_SAVE, async (defaultName: string) => {
    const win = getMainWindow()
    const r = await dialog.showSaveDialog(win ?? undefined!, {
      defaultPath: defaultName,
      filters: [{ name: '备份文件', extensions: ['json'] }]
    })
    return r.canceled || !r.filePath ? null : r.filePath
  })
  handle(
    IpcChannels.BACKUP_PICK_OPEN,
    async (filters: { name: string; extensions: string[] }[]) => {
      const win = getMainWindow()
      const r = await dialog.showOpenDialog(win ?? undefined!, {
        properties: ['openFile'],
        filters
      })
      return r.canceled || !r.filePaths.length ? null : r.filePaths[0]
    }
  )
}
