/**
 * 应用设置的 JSON 存储（原子写：临时文件 + rename，参照 lx-music-desktop 的 Store）。
 *
 * 存于 `userData/data/settings.json`。敏感凭据不走这里，后续用 safeStorage 单独加密。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { app } from 'electron'
import { DEFAULT_SETTINGS, type AppSettings, type DeepPartial } from '@common'
import { appDataPath } from '../core/paths'

let cache: AppSettings | null = null
let volumeTimer: ReturnType<typeof setTimeout> | null = null
app.on('before-quit', () => {
  if (!volumeTimer || !cache) return
  clearTimeout(volumeTimer)
  volumeTimer = null
  persist(cache)
})

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
    const parsed = JSON.parse(raw) as Partial<AppSettings>
    const merged = deepMerge(DEFAULT_SETTINGS, parsed) as AppSettings
    // 已移除的桌面歌词描边字段不再带入运行时或后续持久化文件。
    delete (merged.lyrics as unknown as Record<string, unknown>).desktopShadowColor
    // 旧字段 writeLyricMeta 迁移到 embedLyric（歌词写入标签拆分出翻译/罗马音/逐字子开关）。
    const dl = merged.download as unknown as Record<string, unknown>
    if (typeof dl.writeLyricMeta === 'boolean') {
      dl.embedLyric = dl.writeLyricMeta
      delete dl.writeLyricMeta
    }
    // v1 → v2：整专曲目号前缀改为默认开启（v1 时该项无界面入口，存的 false 均为旧默认值）。
    if ((parsed.version ?? 0) < 2) {
      merged.download.trackNumberPrefix = true
      merged.version = DEFAULT_SETTINGS.version
    }
    return merged
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
  const next = deepMerge(getSettings(), patch) as AppSettings
  if (volumeTimer) clearTimeout(volumeTimer)
  volumeTimer = null
  const onlyVolume =
    Object.keys(patch).length === 1 &&
    patch.player &&
    Object.keys(patch.player).every((key) => key === 'volume' || key === 'muted')
  if (onlyVolume) {
    cache = next
    volumeTimer = setTimeout(() => {
      volumeTimer = null
      try {
        persist(getSettings())
      } catch (e) {
        console.error('[settings] 无法保存音量', e)
      }
    }, 300)
  } else {
    persist(next)
    cache = next
  }
  return cache
}
