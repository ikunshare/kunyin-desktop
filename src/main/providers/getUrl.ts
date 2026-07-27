/**
 * 统一播放地址解析：六大平台共用自建后端（对应 Android tool/MusicUrlHelper.kt）。
 * POST GET_URL_ENDPOINT { platform, musicId, quality, authst } → { url, ekey?, _cacheTTL? }
 * 返回 ekey 时为加密流，由本地音频代理边下边解密。
 */
import { BACKEND_PLATFORM, type MediaInfoResult, type MusicItem } from '@common'
import { GET_URL_ENDPOINT } from '@common'
import { requestJson } from '../net/request'
import { getProvider } from './index'
import { currentAuthst } from '../auth/manager'
import { getCachedMediaInfo, invalidateMediaInfo, setCachedMediaInfo } from '../cache/urlCache'

/** 各平台送给后端的 musicId 取值（对应 MusicUrlHelper 的提取规则） */
function extractMusicId(item: MusicItem): string {
  switch (item.type) {
    case 'qq':
      return item.mid
    case 'joox':
      return item.mid ?? String(item.id)
    case 'kg':
      return item.hash.toLowerCase()
    default:
      return String(item.id)
  }
}

interface GetUrlResponse {
  code: number
  url?: string
  ekey?: string
  _cacheTTL?: number
  message?: string
}

export async function fetchMediaUrl(
  item: MusicItem,
  qualityId: string,
  authst = ''
): Promise<MediaInfoResult> {
  const musicId = extractMusicId(item)
  const resp = await requestJson<GetUrlResponse>(GET_URL_ENDPOINT, {
    method: 'POST',
    body: {
      platform: BACKEND_PLATFORM[item.type],
      musicId,
      quality: qualityId,
      authst
    }
  }).catch(() => null)

  if (!resp || resp.code !== 200 || !resp.url) {
    return {
      source: item.type,
      playUrl: '',
      expire: 0,
      isSuccess: false,
      quality: qualityId,
      rejectReason: resp?.message ?? '获取播放地址失败'
    }
  }

  const ekey = resp.ekey && resp.ekey.length > 0 && resp.ekey !== 'null' ? resp.ekey : undefined
  return {
    source: item.type,
    playUrl: resp.url,
    expire: Date.now() + (resp._cacheTTL ?? 600) * 1000,
    isSuccess: true,
    quality: qualityId,
    musicItem: item,
    encryptionInfo: ekey ? { isEncrypt: true, ekey } : undefined
  }
}

/**
 * 统一播放地址解析：Provider 自定义解析优先（provider.resolveMediaInfo），否则回退后端 getUrl
 * 并注入当前卡密 authst。播放（player handler）与下载（download manager）共用此入口。
 * 成功结果按直链时效缓存，切回最近听过的歌不再重复请求后端。
 */
export async function resolveMediaInfo(
  item: MusicItem,
  qualityId: string
): Promise<MediaInfoResult> {
  // 本地歌曲不走解析（播放在 player handler 直接注册文件流；下载对本地文件无意义）
  if (item.type === 'local') {
    return {
      source: item.type,
      playUrl: '',
      expire: 0,
      isSuccess: false,
      quality: qualityId,
      rejectReason: '本地歌曲无需解析'
    }
  }
  const cached = getCachedMediaInfo(item, qualityId)
  if (cached) return cached
  const provider = getProvider(item.type)
  const custom = provider ? await provider.resolveMediaInfo(item, qualityId) : null
  const info = custom ?? (await fetchMediaUrl(item, qualityId, currentAuthst()))
  setCachedMediaInfo(item, qualityId, info)
  return info
}

/** 播放失败（直链 403/过期）时使缓存失效，下次重新解析。 */
export function invalidateMediaUrl(item: MusicItem, qualityId: string): void {
  invalidateMediaInfo(item, qualityId)
}
