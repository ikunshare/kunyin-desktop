/**
 * 应用自有数据的统一路径：全部放在 `userData/data/` 下，与 Chromium 的运行数据
 * （Cache、Local Storage、Network、Preferences 等散落在 userData 根目录）隔离。
 * 根目录只留内核自己写的东西——备份、排查、清理时一眼可分。
 *
 * 布局：
 *   data/settings.json          应用设置
 *   data/kunyin_music.db        歌单/收藏 SQLite
 *   data/credentials.bin        平台登录凭据
 *   data/auth.bin               卡密
 *   data/download_tasks.json    下载任务
 *   data/lx_sync_session.json   LX 同步会话
 *   data/wy_device.txt          网易设备指纹
 *   data/cache/*.json           业务 LRU 缓存（播放地址/歌词）
 *
 * 业务缓存目录在 data/ 下可以放心叫 `cache`：不再与 Chromium 的 `Cache` 同层，
 * 不区分大小写的文件系统上也不会撞名（旧版为避撞曾叫 data-cache，见迁移）。
 */
import { app } from 'electron'
import { join } from 'node:path'
import { existsSync, mkdirSync, renameSync, rmdirSync } from 'node:fs'

const APP_DATA_DIR = 'data'
/** 业务 LRU 缓存子目录名（相对 data/） */
export const DATA_CACHE_SUBDIR = 'cache'
/** 旧版与 Chromium `Cache` 撞名的业务缓存目录名（仅供迁移/清理引用） */
export const LEGACY_DATA_CACHE_DIR = 'cache'

/** 应用数据目录下的绝对路径；不带参数即数据目录本身 */
export function appDataPath(...segments: string[]): string {
  return join(app.getPath('userData'), APP_DATA_DIR, ...segments)
}

function moveIfPossible(src: string, dst: string): void {
  if (!existsSync(src) || existsSync(dst)) return
  try {
    renameSync(src, dst)
  } catch {
    /* 占用/跨卷等：留在原地，下次启动再试 */
  }
}

/**
 * 整组文件同进退地搬迁：任何一个失败就把已搬的回滚，整组留在原地下次再试。
 * SQLite 主库与 -wal/-shm 必须如此——主库搬走而 wal 留下会丢掉未合并回主库的写入。
 */
function moveGroup(userData: string, names: string[]): void {
  const pending = names.filter((f) => existsSync(join(userData, f)) && !existsSync(appDataPath(f)))
  const done: string[] = []
  try {
    for (const f of pending) {
      renameSync(join(userData, f), appDataPath(f))
      done.push(f)
    }
  } catch {
    for (const f of done) {
      try {
        renameSync(appDataPath(f), join(userData, f))
      } catch {
        /* 回滚也失败：保留现场，SQLite 会按 wal 头部盐值校验，不致误用错档 */
      }
    }
  }
}

/**
 * 启动早期调用一次（任何数据文件读写之前）：建目录，并把散落在 userData
 * 根目录的旧数据文件一次性搬进 data/。迁移失败不阻断启动。
 */
export function initAppDataDir(): void {
  const userData = app.getPath('userData')
  mkdirSync(appDataPath(DATA_CACHE_SUBDIR), { recursive: true })

  for (const f of [
    'settings.json',
    'credentials.bin',
    'auth.bin',
    'download_tasks.json',
    'lx_sync_session.json',
    'wy_device.txt'
  ]) {
    moveIfPossible(join(userData, f), appDataPath(f))
  }
  moveGroup(userData, ['kunyin_music.db', 'kunyin_music.db-wal', 'kunyin_music.db-shm'])

  // 两代旧业务缓存 → data/cache/：data-cache/（上一版）与 cache/（更早，与 Chromium
  // 的 Cache 同层撞名的那版；正常早已被迁走，这里只兜底）
  for (const dir of ['data-cache', LEGACY_DATA_CACHE_DIR]) {
    for (const f of ['url-cache.json', 'lyric-cache.json']) {
      moveIfPossible(join(userData, dir, f), appDataPath(DATA_CACHE_SUBDIR, f))
    }
  }
  // 搬空后的 data-cache 顺手移除（非空则失败，留给缓存清理兜底）；
  // 根目录的 cache/ 是 Chromium Cache 的同名影子目录，绝不能动
  try {
    rmdirSync(join(userData, 'data-cache'))
  } catch {
    /* 不存在或非空：忽略 */
  }
}
