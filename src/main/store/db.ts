/**
 * SQLite 结构化存储底座（better-sqlite3，同步 API）。
 *
 * 表结构 1:1 移植自 Android 端 `database/MusicDatabase.kt`（DATABASE_VERSION=6）的 onCreate 终态：
 * songs / playlists / playlist_songs / song_redirects。桌面端直接从 v6 终态建库，
 * 不搬 Android 的 V1→V6 历史迁移；后续新增迁移用 `user_version` PRAGMA 管理。
 *
 * 系统歌单不是常量而是 `is_system=1` 的行：`system_kind='trial'`（试听列表，兼「最近播放」语义）
 * 与 `'favorites'`（我的收藏），启动 seed。
 *
 * v7（桌面端新增，Android 无对应）：playlists 加 `sort_order` 列，支持「我的列表」左栏拖拽排序。
 */
import { app } from 'electron'
import { join } from 'node:path'
import Database from 'better-sqlite3'

// —— 表名 / 列名（对齐 Android MusicDatabase 常量）——
export const TABLE_SONGS = 'songs'
export const TABLE_PLAYLISTS = 'playlists'
export const TABLE_PLAYLIST_SONGS = 'playlist_songs'
export const TABLE_SONG_REDIRECTS = 'song_redirects'

export const SYSTEM_KIND_TRIAL = 'trial'
export const SYSTEM_KIND_FAVORITES = 'favorites'
export const SYSTEM_TRIAL_NAME = '试听列表'
export const SYSTEM_FAVORITES_NAME = '我的收藏'

/** 当前 schema 版本（v6=Android 终态；v7=桌面端加 playlists.sort_order）。后续加迁移时递增。 */
const SCHEMA_VERSION = 7

let db: Database.Database | null = null

function createSchema(d: Database.Database): void {
  d.exec(`
    CREATE TABLE IF NOT EXISTS ${TABLE_SONGS} (
      song_id INTEGER NOT NULL,
      source TEXT NOT NULL,
      song_json TEXT NOT NULL,
      PRIMARY KEY(song_id, source)
    );

    CREATE TABLE IF NOT EXISTS ${TABLE_PLAYLISTS} (
      playlist_id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      remote_source TEXT,
      remote_id TEXT,
      auto_refresh INTEGER NOT NULL DEFAULT 0,
      is_system INTEGER NOT NULL DEFAULT 0,
      system_kind TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS ${TABLE_PLAYLIST_SONGS} (
      playlist_id INTEGER NOT NULL,
      song_id INTEGER NOT NULL,
      source TEXT NOT NULL,
      added_at INTEGER NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(playlist_id, song_id, source)
    );

    CREATE TABLE IF NOT EXISTS ${TABLE_SONG_REDIRECTS} (
      song_id INTEGER NOT NULL,
      source TEXT NOT NULL,
      target_song_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY(song_id, source)
    );
  `)
}

/**
 * seed 两个系统歌单（不存在才建）。
 * 顺序约定同 Android：试听列表 created_at=2、我的收藏 created_at=1，
 * 配合 `ORDER BY is_system DESC, created_at DESC` 让试听列表排在最前。
 */
function seedSystemPlaylists(d: Database.Database): void {
  const exists = d.prepare(`SELECT 1 FROM ${TABLE_PLAYLISTS} WHERE system_kind = ? LIMIT 1`)
  const insert = d.prepare(
    `INSERT INTO ${TABLE_PLAYLISTS} (name, created_at, auto_refresh, is_system, system_kind)
     VALUES (?, ?, 0, 1, ?)`
  )
  if (!exists.get(SYSTEM_KIND_TRIAL)) insert.run(SYSTEM_TRIAL_NAME, 2, SYSTEM_KIND_TRIAL)
  if (!exists.get(SYSTEM_KIND_FAVORITES))
    insert.run(SYSTEM_FAVORITES_NAME, 1, SYSTEM_KIND_FAVORITES)
}

/**
 * v6 → v7：playlists 增 `sort_order` 列，并按现有 created_at DESC 顺序回填，
 * 使旧库升级后左栏顺序与升级前一致（自建歌单原本按 created_at DESC 展示）。
 */
function migrateV6ToV7(d: Database.Database): void {
  const cols = d.prepare(`PRAGMA table_info(${TABLE_PLAYLISTS})`).all() as { name: string }[]
  if (!cols.some((c) => c.name === 'sort_order')) {
    d.exec(`ALTER TABLE ${TABLE_PLAYLISTS} ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0`)
  }
  const rows = d
    .prepare(
      `SELECT playlist_id FROM ${TABLE_PLAYLISTS} WHERE is_system = 0 ORDER BY created_at DESC`
    )
    .all() as { playlist_id: number }[]
  const upd = d.prepare(`UPDATE ${TABLE_PLAYLISTS} SET sort_order = ? WHERE playlist_id = ?`)
  const tx = d.transaction(() => rows.forEach((r, i) => upd.run(i, r.playlist_id)))
  tx()
}

/** 打开（或复用）数据库单例。首次调用建表 + seed 系统歌单。 */
export function getDb(): Database.Database {
  if (db) return db
  const file = join(app.getPath('userData'), 'kunyin_music.db')
  const d = new Database(file)
  d.pragma('journal_mode = WAL')
  d.pragma('foreign_keys = ON')

  createSchema(d)
  const current = (d.pragma('user_version', { simple: true }) as number) ?? 0
  if (current < SCHEMA_VERSION) {
    // 新库由 createSchema 建成终态；旧库（v6）走增量迁移。
    if (current >= 6 && current < 7) migrateV6ToV7(d)
    d.pragma(`user_version = ${SCHEMA_VERSION}`)
  }
  seedSystemPlaylists(d)

  db = d
  return db
}

/** 关闭数据库（app 退出时调用）。 */
export function closeDb(): void {
  if (db) {
    db.close()
    db = null
  }
}
