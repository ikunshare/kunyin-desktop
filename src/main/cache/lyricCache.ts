/**
 * 歌词缓存：getLyric 每首歌只需拉一次（歌词内容不变，含"无歌词"的负缓存）。
 * LRU 500 条，磁盘持久化；key 用跨端统一的 getMusicItemKey。
 */
import { getMusicItemKey, type Lyric, type MusicItem } from '@common'
import { LruJsonStore } from './lruStore'

interface LyricEntry {
  lyric: Lyric
}

const store = new LruJsonStore<LyricEntry>('lyric-cache.json', 500)

export function getCachedLyric(item: MusicItem): Lyric | null {
  return store.get(getMusicItemKey(item))?.lyric ?? null
}

export function setCachedLyric(item: MusicItem, lyric: Lyric): void {
  store.set(getMusicItemKey(item), { lyric })
}

/** 缓存条目数（设置页展示） */
export function countCachedLyric(): number {
  return store.size()
}

/** 清空歌词缓存（设置页清理按钮） */
export function clearLyricCache(): void {
  store.clear()
}
