/**
 * 应用设置的 JSON 存储（原子写：临时文件 + rename，参照 lx-music-desktop 的 Store）。
 *
 * 存于 `userData/data/settings.json`。敏感凭据不走这里，后续用 safeStorage 单独加密。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { DEFAULT_SETTINGS, type AppSettings, type DeepPartial } from '@common'
import { appDataPath } from '../core/paths'

let cache: AppSettings | null = null

function filePath(): string {
  return appDataPath('settings.json')
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** 深合并：以 base 为骨架，用 patch 覆盖（缺省项保留 base） */
function deepMerge(base: unknown, patch: unknown): unknown {
  if (!isObject(base) || !isObject(patch)) return patch === undefined ? base : patch
  const out: Record<string, unknown> = { ...base }
  for (const key of Object.keys(patch)) {
    const bv = base[key]
    const pv = patch[key]
    out[key] = isObject(bv) && isObject(pv) ? deepMerge(bv, pv) : pv
  }
  return out
}

function load(): AppSettings {
  try {
    const raw = readFileSync(filePath(), 'utf-8')
    return deepMerge(DEFAULT_SETTINGS, JSON.parse(raw)) as AppSettings
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

function persist(settings: AppSettings): void {
  const path = filePath()
  const dir = appDataPath()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const tmp = `${path}.tmp`
  writeFileSync(tmp, JSON.stringify(settings, null, 2), 'utf-8')
  renameSync(tmp, path)
}

export function getSettings(): AppSettings {
  if (!cache) cache = load()
  return cache
}

export function updateSettings(patch: DeepPartial<AppSettings>): AppSettings {
  cache = deepMerge(getSettings(), patch) as AppSettings
  persist(cache)
  return cache
}
