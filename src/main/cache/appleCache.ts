import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { DATA_CACHE_SUBDIR, appDataPath } from '../core/paths'
import { getSettings } from '../store/settings'

interface AppleCacheRecord {
  path: string
  size: number
  usedAt: number
}

const DIRECTORY = 'apple-audio'
const INDEX_FILE = 'apple-audio-index.json'
const records = new Map<string, AppleCacheRecord>()
let loaded = false
let saveTimer: NodeJS.Timeout | null = null

function limitBytes(): number {
  const value = getSettings().player.audioCacheBytes
  return Number.isFinite(value) && value > 0 ? value : 0
}

function directory(): string {
  return appDataPath(DATA_CACHE_SUBDIR, DIRECTORY)
}

function indexPath(): string {
  return appDataPath(DATA_CACHE_SUBDIR, INDEX_FILE)
}

function safeName(key: string): string {
  return key.replace(/[^A-Za-z0-9_-]/g, '-')
}

function totalBytes(): number {
  let total = 0
  for (const record of records.values()) total += record.size
  return total
}

function persist(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    try {
      mkdirSync(appDataPath(DATA_CACHE_SUBDIR), { recursive: true })
      const temp = `${indexPath()}.tmp`
      writeFileSync(temp, JSON.stringify([...records]), 'utf8')
      renameSync(temp, indexPath())
    } catch {
      /* 缓存索引失败不影响播放 */
    }
  }, 300)
}

function ensureLoaded(): void {
  if (loaded) return
  loaded = true
  try {
    const entries = JSON.parse(readFileSync(indexPath(), 'utf8')) as [string, AppleCacheRecord][]
    if (Array.isArray(entries)) {
      for (const [key, record] of entries) {
        if (record?.path && existsSync(record.path) && statSync(record.path).size > 0)
          records.set(key, record)
      }
    }
  } catch {
    /* 首次或索引损坏 */
  }
}

function evict(): void {
  const limit = limitBytes()
  let total = totalBytes()
  for (const [key, record] of records) {
    if (total <= limit) break
    records.delete(key)
    total -= record.size
    void rm(record.path, { force: true }).catch(() => {})
  }
  persist()
}

export function getAppleAudio(key: string): string | null {
  if (limitBytes() <= 0) return null
  ensureLoaded()
  const record = records.get(key)
  if (!record) return null
  try {
    if (statSync(record.path).size <= 0) throw new Error('empty')
  } catch {
    records.delete(key)
    persist()
    return null
  }
  record.usedAt = Date.now()
  records.delete(key)
  records.set(key, record)
  persist()
  return record.path
}

export async function storeAppleAudio(
  key: string,
  sourcePath: string,
  extension: string
): Promise<string> {
  ensureLoaded()
  mkdirSync(directory(), { recursive: true })
  const target = join(directory(), `${safeName(key)}${extension}`)
  await rm(target, { force: true }).catch(() => {})
  await rename(sourcePath, target)
  const size = statSync(target).size
  if (size <= 0) throw new Error('Apple Music 处理后音频为空')
  if (limitBytes() > 0 && size <= limitBytes()) {
    records.delete(key)
    records.set(key, { path: target, size, usedAt: Date.now() })
    evict()
  }
  return target
}

export function dropAppleAudio(key: string): void {
  ensureLoaded()
  const record = records.get(key)
  if (record) void rm(record.path, { force: true }).catch(() => {})
  records.delete(key)
  persist()
}

export function appleAudioStats(): { bytes: number; count: number } {
  ensureLoaded()
  return { bytes: totalBytes(), count: records.size }
}

export async function clearAppleAudio(): Promise<void> {
  ensureLoaded()
  records.clear()
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  persist()
  await rm(directory(), { recursive: true, force: true }).catch(() => {})
}

export function applyAppleAudioLimit(): void {
  if (limitBytes() <= 0) {
    void clearAppleAudio()
    return
  }
  ensureLoaded()
  evict()
}
