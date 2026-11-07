/**
 * 歌词缓存：getLyric 每首歌只需拉一次（歌词内容不变，含"无歌词"的负缓存）。
 * LRU 500 条，磁盘持久化；key 用跨端统一的 getMusicItemKey。
 */
import { EMPTY_LYRIC, getMusicItemKey, type Lyric, type MusicItem } from '@common'
import { LruJsonStore } from './lruStore'

interface LyricEntry {
  lyric: Lyric
  /** 已运行到当前版本的全平台酷狗回退；旧缓存没有该字段，需要补跑一次。 */
  fallbackVersion?: number
  /** 只有「Apple Music 且没拿到 TTML」的条目才记：什么时候确认过没有，见 TTML_RETRY_MS。 */
  ttmlCheckedAt?: number
}

export interface CachedLyric {
  lyric: Lyric
  fallbackChecked: boolean
}

const FALLBACK_VERSION = 1

/**
 * 没有 TTML 的 Apple Music 条目最多信 6 小时。
 * 后端补上原始 TTML 之后不必等用户手清歌词缓存，又不至于让「后端确实只给得出 LRC」的歌
 * 每次播放都回源一次。
 */
const TTML_RETRY_MS = 6 * 60 * 60 * 1000

const store = new LruJsonStore<LyricEntry>('lyric-cache.json', 500)

export function getCachedLyric(item: MusicItem): CachedLyric | null {
  const entry = store.get(getMusicItemKey(item))
  if (!entry) return null
  const lyric = { ...EMPTY_LYRIC, ...entry.lyric }
  // 旧缓存可能缺后加的字段（ttml 就是 Apple Music 接入后才有的），补默认值再交出去，
  // 免得下游 `lyric.ttml.trim()` 撞上 undefined。
  if (item.type === 'am' && !lyric.ttml && Date.now() - (entry.ttmlCheckedAt ?? 0) < TTML_RETRY_MS)
    return null
  return { lyric, fallbackChecked: entry.fallbackVersion === FALLBACK_VERSION }
}

export function setCachedLyric(item: MusicItem, lyric: Lyric): void {
  store.set(getMusicItemKey(item), {
    lyric,
    fallbackVersion: FALLBACK_VERSION,
    ttmlCheckedAt: item.type === 'am' && !lyric.ttml ? Date.now() : undefined
  })
}

/** 缓存条目数（设置页展示） */
export function countCachedLyric(): number {
  return store.size()
}

/** 清空歌词缓存（设置页清理按钮） */
export function clearLyricCache(): void {
  store.clear()
}
