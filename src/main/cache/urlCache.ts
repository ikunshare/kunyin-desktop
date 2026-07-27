/**
 * 播放地址缓存：避免切回刚听过的歌时重复请求后端 getUrl。
 * 直链本身带签名时效（后端 _cacheTTL，默认 600s），按 expire 判活并留 60s 余量；
 * 播放失败（403/过期）时经 PLAYER_URL_INVALIDATE 主动失效。
 */
import type { MediaInfoResult } from '@common'
import { LruJsonStore } from './lruStore'

/** 命中要求的最低剩余时效（过临界点宁可重新解析） */
const MIN_REMAINING_MS = 60_000

const store = new LruJsonStore<MediaInfoResult>('url-cache.json', 200)

function keyOf(item: { type: string; id: number }, qualityId: string): string {
  return `${item.type}_${item.id}_${qualityId}`
}

export function getCachedMediaInfo(
  item: { type: string; id: number },
  qualityId: string
): MediaInfoResult | null {
  const info = store.get(keyOf(item, qualityId))
  if (!info || !info.isSuccess || !info.playUrl) return null
  if (!info.expire || info.expire - Date.now() < MIN_REMAINING_MS) return null
  return info
}

export function setCachedMediaInfo(
  item: { type: string; id: number },
  qualityId: string,
  info: MediaInfoResult
): void {
  // 只缓存标了时效的成功结果（Provider 自定义解析 expire=0 的不入库）
  if (!info.isSuccess || !info.playUrl || !info.expire) return
  if (info.expire - Date.now() < MIN_REMAINING_MS) return
  store.set(keyOf(item, qualityId), info)
}

export function invalidateMediaInfo(item: { type: string; id: number }, qualityId: string): void {
  store.delete(keyOf(item, qualityId))
}

/** 缓存条目数（设置页展示） */
export function countCachedMediaInfo(): number {
  return store.size()
}

/** 清空播放地址缓存（设置页清理按钮） */
export function clearMediaInfoCache(): void {
  store.clear()
}
