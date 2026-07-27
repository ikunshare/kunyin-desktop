/**
 * 本地曲库 Repository（1:1 移植自 Android `database/LocalMusicStore.kt`）。
 *
 * better-sqlite3 是同步 API，故不需要 Android 的 scope.launch 协程；所有写操作同步执行。
 * Android 的响应式 StateFlow（playlistsFlow/favoritesFlow/revision）改为通过 IPC
 * 主动推送给渲染层：写操作后调 `notifyLibraryChanged()`（由 ipc 层注入），渲染层自行重拉。
 *
 * 收藏 = 操作 favorites 系统歌单；试听列表（trial）= 累积列表，点单曲时追加（对齐 Android
 * addToTrial，默认追加末尾不头插；atHead 由设置 trialListAddToHead 控制）。
 */
import type {
  LocalPlaylist,
  MusicItem,
  MusicSource,
  PlaylistSortField,
  PlaylistSortOrder,
  SystemKind
} from '@common'
import {
  getDb,
  SYSTEM_KIND_FAVORITES,
  SYSTEM_KIND_TRIAL,
  SYSTEM_FAVORITES_NAME,
  SYSTEM_TRIAL_NAME,
  TABLE_PLAYLIST_SONGS,
  TABLE_PLAYLISTS,
  TABLE_SONG_REDIRECTS,
  TABLE_SONGS
} from './db'

/** 歌单信息（对应 Android database/Playlist.kt），复用共享类型 */
export type Playlist = LocalPlaylist

// —— 变更通知（多订阅者，等价 Android 的 flow 广播）——
const changeListeners = new Set<() => void>()
export function onLibraryChange(cb: () => void): () => void {
  changeListeners.add(cb)
  return () => changeListeners.delete(cb)
}
function notifyChange(): void {
  for (const cb of changeListeners) cb()
}

// —— 内部 helpers ——
function songSource(item: MusicItem): MusicSource {
  return item.type
}
function songKey(item: MusicItem): string {
  return `${item.id}_${item.type}`
}

/** 收藏快速判定缓存（key=`id_source`），refreshFavoritesCache 时重建。 */
const favoriteKeys = new Set<string>()
/** 重定向缓存：key=`id_source` -> 目标 MusicItem */
const redirectCache = new Map<string, MusicItem>()

let trialIdCache = -1
let favoritesIdCache = -1
let initialized = false

function upsertSong(item: MusicItem): void {
  getDb()
    .prepare(`INSERT OR REPLACE INTO ${TABLE_SONGS} (song_id, source, song_json) VALUES (?, ?, ?)`)
    .run(item.id, item.type, JSON.stringify(item))
}

function querySystemPlaylistId(kind: string): number {
  const row = getDb()
    .prepare(`SELECT playlist_id FROM ${TABLE_PLAYLISTS} WHERE system_kind = ? LIMIT 1`)
    .get(kind) as { playlist_id: number } | undefined
  return row ? row.playlist_id : -1
}

function ensureSystemPlaylist(kind: string, name: string, createdAt: number): number {
  const existing = querySystemPlaylistId(kind)
  if (existing > 0) return existing
  const info = getDb()
    .prepare(
      `INSERT INTO ${TABLE_PLAYLISTS} (name, created_at, auto_refresh, is_system, system_kind)
       VALUES (?, ?, 0, 1, ?)`
    )
    .run(name, createdAt, kind)
  return Number(info.lastInsertRowid)
}

export function getTrialPlaylistId(): number {
  if (trialIdCache > 0) return trialIdCache
  trialIdCache = ensureSystemPlaylist(SYSTEM_KIND_TRIAL, SYSTEM_TRIAL_NAME, 2)
  return trialIdCache
}

export function getFavoritesPlaylistId(): number {
  if (favoritesIdCache > 0) return favoritesIdCache
  favoritesIdCache = ensureSystemPlaylist(SYSTEM_KIND_FAVORITES, SYSTEM_FAVORITES_NAME, 1)
  return favoritesIdCache
}

/** 首次访问时装载系统歌单 id、重定向缓存与收藏缓存。 */
export function initLibrary(): void {
  if (initialized) return
  getDb() // 触发建库 + seed
  trialIdCache = querySystemPlaylistId(SYSTEM_KIND_TRIAL)
  favoritesIdCache = querySystemPlaylistId(SYSTEM_KIND_FAVORITES)
  refreshRedirectCache()
  refreshFavoritesCache()
  initialized = true
}

// ===== 收藏（基于「我的收藏」系统歌单） =====

export function isFavorite(item: MusicItem): boolean {
  return favoriteKeys.has(songKey(item))
}

export function addFavorite(item: MusicItem): void {
  const pid = getFavoritesPlaylistId()
  if (pid <= 0) return
  addToPlaylist(pid, item)
}

export function removeFavorite(item: MusicItem): void {
  const pid = getFavoritesPlaylistId()
  if (pid <= 0) return
  removeFromPlaylist(pid, item)
}

export function toggleFavorite(item: MusicItem): boolean {
  if (isFavorite(item)) {
    removeFavorite(item)
    return false
  }
  addFavorite(item)
  return true
}

// ===== 试听列表（累积容器，对齐 Android addToTrial） =====

/**
 * 将歌曲加入试听列表（对齐 Android LocalMusicStore.addToTrial）。
 * atHead=true 头插，否则追加到末尾（默认，不打乱既有顺序）。
 * 已存在的同一首会先去重（addToPlaylist* 内部处理）。
 */
export function addToTrial(item: MusicItem, atHead: boolean): void {
  const pid = getTrialPlaylistId()
  if (pid <= 0) return
  if (atHead) addToPlaylistAtHead(pid, item)
  else addToPlaylist(pid, item)
}

export function queryTrialSongs(): MusicItem[] {
  const pid = getTrialPlaylistId()
  if (pid <= 0) return []
  return queryPlaylistSongs(pid)
}

// ===== 自定义歌单管理 =====

export function createPlaylist(
  name: string,
  opts: { remoteSource?: string; remoteId?: string; autoRefresh?: boolean } = {}
): number {
  // 新建歌单排到自建列表末尾（sort_order = 现有最大值 + 1）
  const info = getDb()
    .prepare(
      `INSERT INTO ${TABLE_PLAYLISTS}
        (name, created_at, remote_source, remote_id, auto_refresh, is_system, sort_order)
       VALUES (?, ?, ?, ?, ?, 0,
         (SELECT COALESCE(MAX(sort_order) + 1, 0) FROM ${TABLE_PLAYLISTS} WHERE is_system = 0))`
    )
    .run(
      name,
      Date.now(),
      opts.remoteSource ?? null,
      opts.remoteId ?? null,
      opts.autoRefresh ? 1 : 0
    )
  notifyChange()
  return Number(info.lastInsertRowid)
}

/**
 * 重排自建歌单顺序（「我的列表」左栏拖拽）。
 * 只对非系统歌单重排；targetIndex 为目标在自建歌单序列中的位置（0 基）。
 */
export function movePlaylist(playlistId: number, targetIndex: number): void {
  const d = getDb()
  const ids = (
    d
      .prepare(
        `SELECT playlist_id FROM ${TABLE_PLAYLISTS}
         WHERE is_system = 0 ORDER BY sort_order ASC, created_at DESC`
      )
      .all() as { playlist_id: number }[]
  ).map((r) => r.playlist_id)
  const from = ids.indexOf(playlistId)
  if (from < 0) return
  ids.splice(from, 1)
  ids.splice(Math.max(0, Math.min(targetIndex, ids.length)), 0, playlistId)
  const upd = d.prepare(`UPDATE ${TABLE_PLAYLISTS} SET sort_order = ? WHERE playlist_id = ?`)
  const tx = d.transaction(() => ids.forEach((id, i) => upd.run(i, id)))
  tx()
  notifyChange()
}

export function deletePlaylist(playlistId: number): void {
  const d = getDb()
  const row = d
    .prepare(`SELECT is_system FROM ${TABLE_PLAYLISTS} WHERE playlist_id = ?`)
    .get(playlistId) as { is_system: number } | undefined
  if (!row || row.is_system === 1) return // 系统歌单不允许删除
  d.prepare(`DELETE FROM ${TABLE_PLAYLIST_SONGS} WHERE playlist_id = ?`).run(playlistId)
  d.prepare(`DELETE FROM ${TABLE_PLAYLISTS} WHERE playlist_id = ?`).run(playlistId)
  notifyChange()
}

export function renamePlaylist(playlistId: number, newName: string): void {
  getDb()
    .prepare(`UPDATE ${TABLE_PLAYLISTS} SET name = ? WHERE playlist_id = ? AND is_system = 0`)
    .run(newName, playlistId)
  notifyChange()
}

export function addToPlaylist(playlistId: number, item: MusicItem): void {
  const d = getDb()
  const source = songSource(item)
  upsertSong(item)
  const maxRow = d
    .prepare(`SELECT MAX(position) AS m FROM ${TABLE_PLAYLIST_SONGS} WHERE playlist_id = ?`)
    .get(playlistId) as { m: number | null }
  const maxPos = maxRow.m ?? -1
  const info = d
    .prepare(
      `INSERT OR IGNORE INTO ${TABLE_PLAYLIST_SONGS}
        (playlist_id, song_id, source, added_at, position) VALUES (?, ?, ?, ?, ?)`
    )
    .run(playlistId, item.id, source, Date.now(), maxPos + 1)
  if (info.changes > 0) {
    if (playlistId === favoritesIdCache) favoriteKeys.add(songKey(item))
    notifyChange()
  }
}

/** 头插：已存在则先删，其余整体后移 1，再插到 position=0。 */
function addToPlaylistAtHead(playlistId: number, item: MusicItem): void {
  const d = getDb()
  const source = songSource(item)
  upsertSong(item)
  const tx = d.transaction(() => {
    d.prepare(
      `DELETE FROM ${TABLE_PLAYLIST_SONGS} WHERE playlist_id = ? AND song_id = ? AND source = ?`
    ).run(playlistId, item.id, source)
    d.prepare(
      `UPDATE ${TABLE_PLAYLIST_SONGS} SET position = position + 1 WHERE playlist_id = ?`
    ).run(playlistId)
    d.prepare(
      `INSERT OR REPLACE INTO ${TABLE_PLAYLIST_SONGS}
        (playlist_id, song_id, source, added_at, position) VALUES (?, ?, ?, ?, 0)`
    ).run(playlistId, item.id, source, Date.now())
  })
  tx()
  notifyChange()
}

export function removeFromPlaylist(playlistId: number, item: MusicItem): void {
  const info = getDb()
    .prepare(
      `DELETE FROM ${TABLE_PLAYLIST_SONGS} WHERE playlist_id = ? AND song_id = ? AND source = ?`
    )
    .run(playlistId, item.id, songSource(item))
  if (info.changes > 0) {
    if (playlistId === favoritesIdCache) favoriteKeys.delete(songKey(item))
    notifyChange()
  }
}

export function moveSongInPlaylist(playlistId: number, item: MusicItem, newPosition: number): void {
  moveSongInPlaylistDirect(playlistId, item.id, songSource(item), newPosition)
  notifyChange()
}

/**
 * 歌单内歌曲整体排序（LX「排序歌曲」）：按字段与方向重排后重写全部 position。
 * 文本字段用中文感知的 Collator（拼音序、数字自然序）；random 为 Fisher-Yates 打乱。
 */
export function sortPlaylistSongs(
  playlistId: number,
  field: PlaylistSortField,
  order: PlaylistSortOrder
): void {
  const items = queryPlaylistSongs(playlistId)
  if (items.length < 2) return

  let sorted: MusicItem[]
  if (order === 'random') {
    sorted = [...items]
    for (let i = sorted.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[sorted[i], sorted[j]] = [sorted[j], sorted[i]]
    }
  } else {
    const collator = new Intl.Collator('zh-Hans-CN', { numeric: true, sensitivity: 'base' })
    const keyOf = (m: MusicItem): string | number => {
      switch (field) {
        case 'title':
          return m.title
        case 'artist':
          return m.artist
        case 'album':
          return m.album
        case 'duration':
          return m.duration
        case 'source':
          return m.type
      }
    }
    sorted = [...items].sort((a, b) => {
      const ka = keyOf(a)
      const kb = keyOf(b)
      const cmp =
        typeof ka === 'number' && typeof kb === 'number'
          ? ka - kb
          : collator.compare(String(ka), String(kb))
      return order === 'desc' ? -cmp : cmp
    })
  }

  const d = getDb()
  const upd = d.prepare(
    `UPDATE ${TABLE_PLAYLIST_SONGS} SET position = ? WHERE playlist_id = ? AND song_id = ? AND source = ?`
  )
  const tx = d.transaction(() => {
    sorted.forEach((m, i) => upd.run(i, playlistId, m.id, songSource(m)))
  })
  tx()
  notifyChange()
}

/**
 * 整体替换歌单曲目（远端歌单「更新」）：清空后按传入顺序重建。
 * 事务内完成，中途失败自动回滚不丢原数据。
 */
export function replacePlaylistSongs(playlistId: number, items: MusicItem[]): void {
  const d = getDb()
  const now = Date.now()
  const ins = d.prepare(
    `INSERT OR IGNORE INTO ${TABLE_PLAYLIST_SONGS}
      (playlist_id, song_id, source, added_at, position) VALUES (?, ?, ?, ?, ?)`
  )
  const tx = d.transaction(() => {
    d.prepare(`DELETE FROM ${TABLE_PLAYLIST_SONGS} WHERE playlist_id = ?`).run(playlistId)
    items.forEach((m, i) => {
      upsertSong(m)
      ins.run(playlistId, m.id, songSource(m), now, i)
    })
  })
  tx()
  notifyChange()
}

// ===== 查询 =====

/** 解析歌曲 JSON，若有重定向则替换封面为目标歌曲封面（对齐 Android parseSongWithRedirect）。 */
function parseSongWithRedirect(songJson: string): MusicItem {
  const item = JSON.parse(songJson) as MusicItem
  if (redirectCache.size === 0) return item
  const target = redirectCache.get(`${item.id}_${item.type}`)
  if (target && target.cover) item.cover = target.cover
  return item
}

export function queryPlaylistSongs(playlistId: number, limit?: number, offset = 0): MusicItem[] {
  const paged = limit != null
  const sql =
    `SELECT s.song_json AS j
     FROM ${TABLE_PLAYLIST_SONGS} ps
     INNER JOIN ${TABLE_SONGS} s ON ps.song_id = s.song_id AND ps.source = s.source
     WHERE ps.playlist_id = ?
     ORDER BY ps.position ASC` + (paged ? ` LIMIT ? OFFSET ?` : ``)
  const rows = (
    paged
      ? getDb().prepare(sql).all(playlistId, limit, offset)
      : getDb().prepare(sql).all(playlistId)
  ) as { j: string }[]
  const items: MusicItem[] = []
  for (const r of rows) {
    try {
      items.push(parseSongWithRedirect(r.j))
    } catch {
      /* skip corrupt rows */
    }
  }
  return items
}

/** 全部歌单（含系统歌单在前），带曲目数与首曲封面。对齐 Android refreshPlaylists。 */
export function getPlaylists(): Playlist[] {
  const rows = getDb()
    .prepare(
      `SELECT p.playlist_id, p.name, p.created_at, p.remote_source, p.remote_id,
              p.auto_refresh, p.is_system, p.system_kind,
              COUNT(ps.song_id) AS song_count,
              (SELECT s2.song_json FROM ${TABLE_PLAYLIST_SONGS} ps2
                 INNER JOIN ${TABLE_SONGS} s2
                   ON ps2.song_id = s2.song_id AND ps2.source = s2.source
                 WHERE ps2.playlist_id = p.playlist_id
                 ORDER BY ps2.position ASC LIMIT 1) AS first_song_json
       FROM ${TABLE_PLAYLISTS} p
       LEFT JOIN ${TABLE_PLAYLIST_SONGS} ps ON p.playlist_id = ps.playlist_id
       GROUP BY p.playlist_id
       ORDER BY p.is_system DESC, p.sort_order ASC, p.created_at DESC`
    )
    .all() as Record<string, unknown>[]
  return rows.map((r) => {
    let coverUrl: string | undefined
    if (r.first_song_json) {
      try {
        coverUrl = (JSON.parse(r.first_song_json as string) as MusicItem).cover || undefined
      } catch {
        coverUrl = undefined
      }
    }
    return {
      id: r.playlist_id as number,
      name: r.name as string,
      createdAt: r.created_at as number,
      songCount: r.song_count as number,
      coverUrl,
      remoteSource: (r.remote_source as string) ?? undefined,
      remoteId: (r.remote_id as string) ?? undefined,
      autoRefresh: (r.auto_refresh as number) !== 0,
      isSystem: (r.is_system as number) !== 0,
      systemKind: (r.system_kind as SystemKind) ?? undefined
    }
  })
}

export function getPlaylist(playlistId: number): Playlist | undefined {
  return getPlaylists().find((p) => p.id === playlistId)
}

/** 通过远端 source+id 查找已收藏（本地副本）的歌单。 */
export function getPlaylistByRemoteId(
  remoteSource: string,
  remoteId: string
): Playlist | undefined {
  return getPlaylists().find((p) => p.remoteSource === remoteSource && p.remoteId === remoteId)
}

export function setAutoRefresh(playlistId: number, enabled: boolean): void {
  getDb()
    .prepare(`UPDATE ${TABLE_PLAYLISTS} SET auto_refresh = ? WHERE playlist_id = ?`)
    .run(enabled ? 1 : 0, playlistId)
  notifyChange()
}

/** 刷新已存歌曲信息（音质/封面刷新后回写）。 */
export function updateSongInfo(item: MusicItem): void {
  upsertSong(item)
}

// ===== 收藏缓存重建 =====

function refreshFavoritesCache(): void {
  const pid = favoritesIdCache > 0 ? favoritesIdCache : querySystemPlaylistId(SYSTEM_KIND_FAVORITES)
  favoritesIdCache = pid
  favoriteKeys.clear()
  if (pid <= 0) return
  for (const item of queryPlaylistSongs(pid)) favoriteKeys.add(songKey(item))
}

// ===== 同步/备份用直写方法（无副作用广播，供 LX 同步与备份恢复批量调用） =====

export function createPlaylistDirect(name: string, createdAt: number): number {
  const info = getDb()
    .prepare(
      `INSERT INTO ${TABLE_PLAYLISTS} (name, created_at, is_system, sort_order)
       VALUES (?, ?, 0,
         (SELECT COALESCE(MAX(sort_order) + 1, 0) FROM ${TABLE_PLAYLISTS} WHERE is_system = 0))`
    )
    .run(name, createdAt)
  return Number(info.lastInsertRowid)
}

export function addToPlaylistDirect(
  playlistId: number,
  songJson: string,
  addedAt: number,
  position: number
): void {
  try {
    const item = JSON.parse(songJson) as MusicItem
    upsertSong(item)
    getDb()
      .prepare(
        `INSERT OR IGNORE INTO ${TABLE_PLAYLIST_SONGS}
          (playlist_id, song_id, source, added_at, position) VALUES (?, ?, ?, ?, ?)`
      )
      .run(playlistId, item.id, item.type, addedAt, position)
  } catch {
    /* skip invalid entries */
  }
}

/** 追加到尾部（不去重），返回分配到的 position。 */
export function appendSongDirect(playlistId: number, songJson: string, addedAt: number): number {
  const row = getDb()
    .prepare(
      `SELECT COALESCE(MAX(position) + 1, 0) AS n FROM ${TABLE_PLAYLIST_SONGS} WHERE playlist_id = ?`
    )
    .get(playlistId) as { n: number }
  addToPlaylistDirect(playlistId, songJson, addedAt, row.n)
  return row.n
}

export function removeFromPlaylistDirect(playlistId: number, songId: number, source: string): void {
  getDb()
    .prepare(
      `DELETE FROM ${TABLE_PLAYLIST_SONGS} WHERE playlist_id = ? AND song_id = ? AND source = ?`
    )
    .run(playlistId, songId, source)
}

export function clearPlaylistDirect(playlistId: number): void {
  getDb().prepare(`DELETE FROM ${TABLE_PLAYLIST_SONGS} WHERE playlist_id = ?`).run(playlistId)
}

export function renamePlaylistDirect(playlistId: number, newName: string): void {
  getDb()
    .prepare(`UPDATE ${TABLE_PLAYLISTS} SET name = ? WHERE playlist_id = ? AND is_system = 0`)
    .run(newName, playlistId)
}

export function deletePlaylistDirect(playlistId: number): void {
  const d = getDb()
  const row = d
    .prepare(`SELECT is_system FROM ${TABLE_PLAYLISTS} WHERE playlist_id = ?`)
    .get(playlistId) as { is_system: number } | undefined
  if (!row || row.is_system === 1) return
  d.prepare(`DELETE FROM ${TABLE_PLAYLIST_SONGS} WHERE playlist_id = ?`).run(playlistId)
  d.prepare(`DELETE FROM ${TABLE_PLAYLISTS} WHERE playlist_id = ?`).run(playlistId)
}

export function moveSongInPlaylistDirect(
  playlistId: number,
  songId: number,
  source: string,
  targetPos: number
): void {
  const d = getDb()
  const entries = d
    .prepare(
      `SELECT song_id, source FROM ${TABLE_PLAYLIST_SONGS} WHERE playlist_id = ? ORDER BY position ASC`
    )
    .all(playlistId) as { song_id: number; source: string }[]
  const idx = entries.findIndex((e) => e.song_id === songId && e.source === source)
  if (idx < 0) return
  const [entry] = entries.splice(idx, 1)
  entries.splice(Math.max(0, Math.min(targetPos, entries.length)), 0, entry)
  const upd = d.prepare(
    `UPDATE ${TABLE_PLAYLIST_SONGS} SET position = ? WHERE playlist_id = ? AND song_id = ? AND source = ?`
  )
  const tx = d.transaction(() => {
    entries.forEach((e, i) => upd.run(i, playlistId, e.song_id, e.source))
  })
  tx()
}

/** 头部插入前，把歌单内全部歌曲 position += delta。 */
export function shiftPositionsDirect(playlistId: number, delta: number): void {
  if (delta === 0) return
  getDb()
    .prepare(`UPDATE ${TABLE_PLAYLIST_SONGS} SET position = position + ? WHERE playlist_id = ?`)
    .run(delta, playlistId)
}

export function setRemoteIdDirect(
  playlistId: number,
  remoteSource: string,
  remoteId: string
): void {
  getDb()
    .prepare(`UPDATE ${TABLE_PLAYLISTS} SET remote_source = ?, remote_id = ? WHERE playlist_id = ?`)
    .run(remoteSource, remoteId, playlistId)
}

export function findCustomPlaylistByName(name: string): Playlist | undefined {
  return getPlaylists().find((p) => !p.isSystem && p.name === name)
}

/** 备份导出：收藏歌曲原始 JSON + 加入时间。 */
export function queryPlaylistSongsRaw(
  playlistId: number
): { songJson: string; addedAt: number; position: number }[] {
  const rows = getDb()
    .prepare(
      `SELECT s.song_json AS j, ps.added_at AS a, ps.position AS p
       FROM ${TABLE_PLAYLIST_SONGS} ps
       INNER JOIN ${TABLE_SONGS} s ON ps.song_id = s.song_id AND ps.source = s.source
       WHERE ps.playlist_id = ? ORDER BY ps.position ASC`
    )
    .all(playlistId) as { j: string; a: number; p: number }[]
  return rows.map((r) => ({ songJson: r.j, addedAt: r.a, position: r.p }))
}

/** 备份恢复后重建内存缓存（收藏 + 重定向）。 */
export function refreshAfterRestore(): void {
  refreshRedirectCache()
  refreshFavoritesCache()
  notifyChange()
}

// ===== 歌词/封面重定向 =====

export function getRedirect(item: MusicItem): MusicItem | undefined {
  return redirectCache.get(songKey(item))
}

export function hasRedirect(item: MusicItem): boolean {
  return redirectCache.has(songKey(item))
}

export function setRedirect(source: MusicItem, target: MusicItem): void {
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO ${TABLE_SONG_REDIRECTS}
        (song_id, source, target_song_json, created_at) VALUES (?, ?, ?, ?)`
    )
    .run(source.id, source.type, JSON.stringify(target), Date.now())
  redirectCache.set(songKey(source), target)
  refreshFavoritesCache()
  notifyChange()
}

export function clearRedirect(item: MusicItem): void {
  getDb()
    .prepare(`DELETE FROM ${TABLE_SONG_REDIRECTS} WHERE song_id = ? AND source = ?`)
    .run(item.id, item.type)
  if (redirectCache.delete(songKey(item))) {
    refreshFavoritesCache()
    notifyChange()
  }
}

function refreshRedirectCache(): void {
  redirectCache.clear()
  const rows = getDb()
    .prepare(`SELECT song_id, source, target_song_json FROM ${TABLE_SONG_REDIRECTS}`)
    .all() as { song_id: number; source: string; target_song_json: string }[]
  for (const r of rows) {
    try {
      redirectCache.set(`${r.song_id}_${r.source}`, JSON.parse(r.target_song_json) as MusicItem)
    } catch {
      /* skip */
    }
  }
}
