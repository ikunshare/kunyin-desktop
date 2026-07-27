/**
 * Spotify Provider（自建后端 /music/* 中转，X-Api-Key 卡密鉴权）。
 *
 * - search：POST /music/search {source:'sp', keyword, limit, page(1 起)}；
 *   结果无音质信息，随后逐条调 /music/info 补全 qualities（并发、失败静默回退默认档位）。
 * - 播放：覆写 resolveMediaInfo 走 /music/url（非 /app/getUrl）；返回 ekey 为 AES-128-CTR
 *   加密流（hex 密钥 + 固定 IV，见 crypto/aesctr.ts），由音频协议边下边解密。
 * - 歌词/专辑/歌单/歌手：后端无对应接口，沿用基类空实现。
 */
import {
  MUSIC_API_BASE,
  type MediaInfoResult,
  type MusicItem,
  type MusicListResult,
  type Quality,
  type SpotifyMusicItem
} from '@common'
import { BaseProvider } from '../base'
import { requestJson } from '../../net/request'
import { currentAuthst } from '../../auth/manager'

/** 默认档位（info 补全失败时的兜底；64k 低于全平台最低档，直接忽略） */
const DEFAULT_QUALITIES: Record<string, Quality> = {
  '128k': { id: '128k', name: '普通音质 128K', filesize: 0, bitrate: 128 },
  '320k': { id: '320k', name: '高品音质 320K', filesize: 0, bitrate: 320 }
}
const QUALITY_NAMES: Record<string, string> = {
  '128k': '普通音质 128K',
  '320k': '高品音质 320K',
  flac: '无损音质 FLAC'
}

interface SpSearchEntry {
  songId?: string
  songName?: string
  artistName?: string
  albumName?: string
  albumId?: string
  coverUrl?: string
  duration?: string
}

interface SpInfoResponse {
  code: number
  data?: { quality?: Record<string, boolean>; copyright?: boolean }
  message?: string
}

interface SpUrlResponse {
  code: number
  url?: string
  ekey?: string
  quality?: string
  message?: string
}

/** "mm:ss"（或 "hh:mm:ss"）→ 毫秒 */
function parseDuration(s: unknown): number {
  if (typeof s !== 'string') return 0
  const parts = s
    .trim()
    .split(':')
    .map((x) => Number(x))
  if (parts.some((n) => !Number.isFinite(n))) return 0
  return parts.reduce((acc, n) => acc * 60 + n, 0) * 1000
}

/** sid（base62 字符串）→ 凑 BaseMusicItem 数值身份的 FNV-1a 哈希；唯一性以 sid 为准 */
function hashSid(sid: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < sid.length; i++) {
    h ^= sid.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** 直链 verify=<unix秒> 签名参数 → 过期时间戳（提前 30s 视为过期）；取不到给 10 分钟兜底 */
function parseExpire(url: string): number {
  const m = /[?&]verify=(\d+)/.exec(url)
  if (m) return Number(m[1]) * 1000 - 30_000
  return Date.now() + 600_000
}

export class SpProvider extends BaseProvider {
  readonly source = 'sp' as const
  readonly displayName = 'Spotify'

  private apiKey(): string {
    return currentAuthst()
  }

  private parseEntry(o: SpSearchEntry): SpotifyMusicItem | null {
    if (!o?.songId || o.songName == null) return null
    return {
      type: 'sp',
      sid: o.songId,
      id: hashSid(o.songId),
      title: o.songName,
      artist: o.artistName ?? '',
      album: o.albumName ?? '',
      cover: o.coverUrl ?? '',
      duration: parseDuration(o.duration),
      qualities: { ...DEFAULT_QUALITIES },
      albumId: o.albumId
    }
  }

  /** 调 /music/info 把单条的 qualities 换成后端报告的真实档位（失败保持默认） */
  private async fillQualities(item: SpotifyMusicItem): Promise<void> {
    const json = await requestJson<SpInfoResponse>(`${MUSIC_API_BASE}/info`, {
      method: 'POST',
      headers: { 'X-Api-Key': this.apiKey() },
      body: { source: 'sp', musicId: item.sid },
      timeout: 5000
    }).catch(() => null)
    const q = json?.code === 200 ? json.data?.quality : undefined
    if (!q) return
    const qualities: Record<string, Quality> = {}
    for (const id of Object.keys(QUALITY_NAMES)) {
      if (q[id]) qualities[id] = { id, name: QUALITY_NAMES[id], filesize: 0 }
    }
    if (Object.keys(qualities).length) item.qualities = qualities
  }

  async search(keyword: string, page = 0, size = 20): Promise<MusicListResult> {
    const json = await requestJson<{ code: number; data?: SpSearchEntry[] }>(
      `${MUSIC_API_BASE}/search`,
      {
        method: 'POST',
        headers: { 'X-Api-Key': this.apiKey() },
        body: { source: 'sp', keyword, limit: size, page: page + 1 } // 后端页码 1 起
      }
    ).catch(() => null)
    const data = json?.code === 200 && Array.isArray(json.data) ? json.data : []
    const items = data.map((x) => this.parseEntry(x)).filter((x): x is SpotifyMusicItem => !!x)
    // 补全真实音质档（并发，单条失败不影响整体）
    await Promise.all(items.map((it) => this.fillQualities(it)))
    // 无总数字段：拿满一页才可能有下一页
    return { source: 'sp', hasNext: data.length >= size, page, size, result: items }
  }

  /** sp 不走 /app/getUrl：/music/url 自行解析（响应 ekey 为 AES-128-CTR 加密流） */
  async resolveMediaInfo(item: MusicItem, qualityId: string): Promise<MediaInfoResult | null> {
    if (item.type !== 'sp') return null
    const fail = (reason: string): MediaInfoResult => ({
      source: 'sp',
      playUrl: '',
      expire: 0,
      isSuccess: false,
      quality: qualityId,
      rejectReason: reason
    })
    const json = await requestJson<SpUrlResponse>(`${MUSIC_API_BASE}/url`, {
      method: 'POST',
      headers: { 'X-Api-Key': this.apiKey() },
      body: { source: 'sp', musicId: item.sid, quality: qualityId }
    }).catch(() => null)
    if (!json || json.code !== 200 || !json.url) {
      return fail(json?.message ?? '获取播放地址失败')
    }
    const ekey = json.ekey && json.ekey.length > 0 && json.ekey !== 'null' ? json.ekey : undefined
    return {
      source: 'sp',
      playUrl: json.url,
      expire: parseExpire(json.url),
      isSuccess: true,
      quality: json.quality ?? qualityId,
      musicItem: item,
      encryptionInfo: ekey ? { isEncrypt: true, ekey, cipher: 'aes-ctr' } : undefined
    }
  }
}
