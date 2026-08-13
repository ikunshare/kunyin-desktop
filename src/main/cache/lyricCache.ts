/**
 * 歌词缓存：getLyric 每首歌只需拉一次（歌词内容不变，含"无歌词"的负缓存）。
 * LRU 500 条，磁盘持久化；key 用跨端统一的 getMusicItemKey。
 */
import { getMusicItemKey, type Lyric, type MusicItem } from '@common'
import { LruJsonStore } from './lruStore'

interface LyricEntry {
  lyric: Lyric
  /** 已运行到当前版本的全平台酷狗回退；旧缓存没有该字段，需要补跑一次。 */
  fallbackVersion?: number
}

export interface CachedLyric {
  lyric: Lyric
  fallbackChecked: boolean
}

const FALLBACK_VERSION = 1
const store = new LruJsonStore<LyricEntry>('lyric-cache.json', 500)

export function getCachedLyric(item: MusicItem): CachedLyric | null {
  const entry = store.get(getMusicItemKey(item))
  if (!entry) return null
  return { lyric: entry.lyric, fallbackChecked: entry.fallbackVersion === FALLBACK_VERSION }
}

export function setCachedLyric(item: MusicItem, lyric: Lyric): void {
  store.set(getMusicItemKey(item), { lyric, fallbackVersion: FALLBACK_VERSION })
}

/** 缓存条目数（设置页展示） */
export function countCachedLyric(): number {
  return store.size()
}

/** 清空歌词缓存（设置页清理按钮） */
export function clearLyricCache(): void {
  store.clear()
}
