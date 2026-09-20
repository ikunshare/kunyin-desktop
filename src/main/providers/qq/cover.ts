/**
 * QQ 无专辑曲目的封面补全（移植自 qqmusichd 的 CommonBody.calculateTechVersion / generateUrl）。
 *
 * 翻唱、用户上传、部分下架曲目的 track_info 里 album 全空，常规 `T002R800x800M000{albumMid}.jpg`
 * 拼不出来，parseTrackInfo 只能退到歌手头像。开放平台接口
 * `fcg_music_custom_get_song_info_batch.fcg` 对这类曲目仍会返回 album_pic_*（真实封面的 picMid），
 * 这里按 mid 批量补一次：
 * - 单次最多 50 个 mid（超过服务端回 ret=100004「歌曲数量取值范围1到50」）；
 * - 结果按 mid 进 LRU 磁盘缓存，含「接口正常返回但没这首」的负缓存，同一首歌只查一次；
 * - 封面是非关键信息：网络/签名/解析任何一步失败都静默吞掉，列表照常返回。
 */
import { createHash } from 'node:crypto'
import type { MusicItem, QQMusicItem } from '@common'
import { requestJson } from '../../net/request'
import { LruJsonStore } from '../../cache/lruStore'

const OPI_URL = 'https://qplaycloud.y.qq.com/rpc_proxy/fcgi-bin/music_open_api.fcg'
const OPI_APP_ID = '2000000638'
const OPI_APP_KEY = 'ZKFKQDruNqOogrgL'
const OPI_SPLIT = '_'
/** 服务端单次查询上限 */
const OPI_BATCH_MAX = 50
const REQUEST_TIMEOUT = 8000

/** mid → 封面 URL；空串表示查过但接口没给（负缓存） */
const store = new LruJsonStore<string>('qq-cover-cache.json', 2000)

function md5Hex(s: string): string {
  return createHash('md5').update(s, 'utf8').digest('hex')
}

/**
 * 生成带签名的开放平台 URL（对照 generateUrl → calculateTechVersion → generateSortParameterString → appendMap）。
 * `timestamp` 参数化只为可复现地校验签名，业务调用不传。
 *
 * - tech_version = `sdk|md5("sdk_" + appKey + "_" + timestamp)`，参与 sign 计算；
 * - sign = md5(按 key 排序的 `k=v` 用 & 拼接 + "_" + appKey)；
 * - 查询串按插入顺序编码。Java URLEncoder 与 encodeURIComponent 只在 `!'()*~` 与空格上有别，
 *   本接口参数不含这些字符，直接用后者。
 */
export function buildOpiUrl(
  params: Record<string, string>,
  timestamp = Math.floor(Date.now() / 1000)
): string {
  const p: Record<string, string> = { ...params, timestamp: String(timestamp) }
  p.tech_version = `sdk|${md5Hex(`sdk_${OPI_APP_KEY}${OPI_SPLIT}${timestamp}`)}`
  const sorted =
    Object.keys(p)
      .sort()
      .map((k) => `${k}=${p[k]}`)
      .join('&') +
    OPI_SPLIT +
    OPI_APP_KEY
  p.sign = md5Hex(sorted)
  const qs = Object.entries(p)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&')
  return `${OPI_URL}?${qs}`
}

/** fcg_music_custom_get_song_info_batch.fcg 的固定参数（listen_together 渠道、未登录） */
export function songInfoBatchParams(mids: readonly string[]): Record<string, string> {
  return {
    app_id: OPI_APP_ID,
    chid: 'listen_together',
    client_ip: '127.0.0.1',
    ct: 'iOS',
    cv: '',
    device_id: '1',
    enc_vkey_url: '0',
    login_type: '1',
    opi_cmd: 'fcg_music_custom_get_song_info_batch.fcg',
    opi_protocol_version: '0',
    qqmusic_access_token: '',
    qqmusic_open_appid: OPI_APP_ID,
    qqmusic_open_id: '',
    sign_version: 'v2',
    song_mid: mids.join(','),
    song_token: ''
  }
}

interface OpiSong {
  song_mid?: string
  album_pic_500x500?: string
  album_pic?: string
}

/** 接口给的是 http 的 500x500；统一成与其他 QQ 封面一致的 https 800x800（CDN 各档尺寸按需生成） */
function pickCover(song: OpiSong): string {
  const raw = song.album_pic_500x500 || song.album_pic || ''
  if (!raw) return ''
  return raw.replace(/^http:/, 'https:').replace(/R\d+x\d+M000/, 'R800x800M000')
}

/**
 * 查一批 mid 的封面。返回 null 表示这次请求整体失败（不写缓存，下次再试）；
 * 返回的 Map 对每个请求过的 mid 都有值，接口没回的记空串。
 */
async function fetchCoversByMid(mids: readonly string[]): Promise<Map<string, string> | null> {
  const json = await requestJson<{ ret?: number; songlist?: OpiSong[] }>(
    buildOpiUrl(songInfoBatchParams(mids)),
    { timeout: REQUEST_TIMEOUT }
  ).catch(() => null)
  if (!json || json.ret !== 0 || !Array.isArray(json.songlist)) return null
  const out = new Map<string, string>()
  for (const mid of mids) out.set(mid, '')
  for (const song of json.songlist) {
    if (song?.song_mid) out.set(song.song_mid, pickCover(song))
  }
  return out
}

/**
 * 就地补全列表里「无专辑」QQ 曲目的封面（其他源与有专辑的曲目原样跳过）。
 * 列表里没有这类曲目时不发请求；有的话先查缓存，剩余的按 50 个一批并发查。
 *
 * 这里的 Promise.all 看着是无界扇出，实际由 net/request.ts 的 per-host 闸限流：
 * 同 host 只有固定几个在飞，其余排队。别把 requestJson 换成裸 net.fetch，
 * 否则大歌单会打爆 Chromium 的 per-host socket 额度，连播放取流一起卡住。
 */
export async function fillMissingQqCovers(items: readonly MusicItem[]): Promise<void> {
  const pending = new Map<string, QQMusicItem[]>()
  for (const item of items) {
    if (item.type !== 'qq' || item.albumMid || !item.mid) continue
    const cached = store.get(item.mid)
    if (cached !== undefined) {
      if (cached) item.cover = cached
      continue
    }
    const list = pending.get(item.mid) ?? []
    list.push(item)
    pending.set(item.mid, list)
  }
  if (!pending.size) return

  const mids = [...pending.keys()]
  const chunks: string[][] = []
  for (let i = 0; i < mids.length; i += OPI_BATCH_MAX) chunks.push(mids.slice(i, i + OPI_BATCH_MAX))
  const results = await Promise.all(chunks.map((chunk) => fetchCoversByMid(chunk)))
  for (const map of results) {
    if (!map) continue
    for (const [mid, cover] of map) {
      store.set(mid, cover)
      if (!cover) continue
      for (const item of pending.get(mid) ?? []) item.cover = cover
    }
  }
}
