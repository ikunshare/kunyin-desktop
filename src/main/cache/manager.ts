/**
 * 缓存管理（设置页「缓存管理」的后端）。
 *
 * 两类缓存来源不同，清理方式也不同：
 * - 资源缓存：封面等图片由渲染层 <img> 直连 CDN，落在 Chromium 自己的 HTTP 磁盘缓存
 *   （userData/Cache、Code Cache、GPUCache 等），故大小靠遍历目录得出、清理走 session.clearCache()。
 * - 业务缓存：播放地址 / 歌词，是我们自己的 LruJsonStore，按条目数统计。
 *
 * 业务缓存存于 `data/cache/`（见 core/paths.ts），与 Chromium 的数据完全分离。
 */
import { app, session } from 'electron'
import { join } from 'node:path'
import { readdir, rm, stat } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import type { CacheStats } from '@common'
import { clearMediaInfoCache, countCachedMediaInfo } from './urlCache'
import { clearLyricCache, countCachedLyric } from './lyricCache'
import { LEGACY_DATA_CACHE_DIR } from '../core/paths'

/** Chromium 落盘缓存的目录名（相对 userData） */
const RESOURCE_CACHE_DIRS = [
  'Cache',
  'Code Cache',
  'GPUCache',
  'DawnGraphiteCache',
  'DawnWebGPUCache',
  'Shared Dictionary',
  'blob_storage'
]

/**
 * 已废弃功能留下的孤儿目录：不再有代码写入，但老用户机器上仍占着盘，清理资源缓存时一并删除。
 * - cache/cover：旧版自建封面磁盘缓存（封面已改为 <img> 直连 + Chromium 缓存）
 * - Partitions：旧版网页登录（webview）的独立 session 分区
 * - data-cache：上一版业务缓存目录（已迁至 data/cache/，见 core/paths.ts）
 *
 * 只列在这里、不并入 RESOURCE_CACHE_DIRS：`cache` 与 `Cache` 在不区分大小写的文件系统上
 * 是同一目录，`cover` 已被 'Cache' 的递归统计涵盖，再算一次就重复了。
 */
const LEGACY_DIRS = [join(LEGACY_DATA_CACHE_DIR, 'cover'), 'Partitions', 'data-cache']

/** 参与大小统计的目录：Chromium 缓存 + 孤儿 Partitions（cover 见上，不重复计） */
const SIZE_DIRS = [...RESOURCE_CACHE_DIRS, 'Partitions']

/** 递归累加目录占用字节；目录不存在或无权限时按 0 计，不让统计失败拖垮整个面板 */
async function dirSize(path: string): Promise<number> {
  let total = 0
  let entries: Dirent[]
  try {
    entries = await readdir(path, { withFileTypes: true })
  } catch {
    return 0
  }
  for (const entry of entries) {
    const full = join(path, entry.name)
    if (entry.isDirectory()) {
      total += await dirSize(full)
    } else if (entry.isFile()) {
      try {
        total += (await stat(full)).size
      } catch {
        /* 遍历途中文件被删：忽略 */
      }
    }
  }
  return total
}

/** 汇总各类缓存用量（设置页打开与每次清理后调用） */
export async function getCacheStats(): Promise<CacheStats> {
  const userData = app.getPath('userData')
  const sizes = await Promise.all(SIZE_DIRS.map((d) => dirSize(join(userData, d))))
  return {
    resourceBytes: sizes.reduce((a, b) => a + b, 0),
    urlCount: countCachedMediaInfo(),
    lyricCount: countCachedLyric()
  }
}

/** 清理资源缓存（Chromium HTTP 缓存：封面图等，外加已废弃功能的孤儿目录） */
export async function clearResourceCache(): Promise<void> {
  await session.defaultSession.clearCache()
  const userData = app.getPath('userData')
  await Promise.all(
    LEGACY_DIRS.map((d) =>
      rm(join(userData, d), { recursive: true, force: true }).catch(() => {
        /* 目录不存在或被占用：忽略 */
      })
    )
  )
}

/** 清理播放地址缓存 */
export function clearUrlCache(): void {
  clearMediaInfoCache()
}

/** 清理歌词缓存 */
export function clearLyricCacheAll(): void {
  clearLyricCache()
}
