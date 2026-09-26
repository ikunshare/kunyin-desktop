/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 网易云听歌上报（逐字移植自 folltoshe/netease-report-listen-song 的 src/desktop，
 * 出处 https://github.com/folltoshe/netease-report-listen-song）。
 *
 * 走的是 PC 客户端的埋点通道，不是任何「刷听歌量」的公开 API：把一条埋点记录
 * （`<秒级时刻>\x01<动作>\x01<JSON>`）封成 NCBL（见 crypto/ncbl.ts），以 multipart
 * 上传到 clientlog3。两个动作对应播放的两端：
 *
 * - `_plv`：开始播放某首歌（play view），带音质/来源；
 * - `_pld`：这一段播完/被打断（play duration），带实际播放秒数，听歌记录与年度报告吃这一条。
 *
 * 移植要点（别凭感觉改，改了服务端只会静默丢包）：
 * - 请求要「像 PC 客户端」：登录态与设备指纹**同时**出现在 cookie 和 NCBL 的元信息块里，
 *   两处必须一致；deviceId / osver 直接复用 crypto/netease.ts 那一份，保证和 eapi 请求同一台设备。
 * - 上报里的客户端版本（3.1.35.205293）与 `_addrefer` 里的构建号 c9156c3 是上游抓包到的同一组值，
 *   refer 串里还嵌着页面 spm 路径，成套照抄，别只改其中一个。
 * - 一次上传只封一条记录（NCBL 的记录之间没有分隔符，见 buildRecords 注释）。
 * - 失败一律静默返回 false：这是旁路，绝不能影响播放。
 */
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import type { NeteaseMusicItem } from '@common'
import { buildRecords, encryptNcbl, type LogRecord } from '../../crypto/ncbl'
import { OS_VER, eapiPost, extractMusicU, getDeviceId } from '../../crypto/netease'
import { requestJson } from '../../net/request'
import { appDataPath } from '../../core/paths'
import { createLogger } from '../../core/logger'

const log = createLogger('wy-report')

const UPLOAD_URL = 'https://clientlog3.music.163.com/api/clientlog/encrypt/upload'

/** 伪装的 PC 客户端版本：和下面 refer 串里的构建号 c9156c3 是同一组抓包值，成套使用 */
const APP_VERSION = '3.1.35'
const APP_VERSION_CODE = '205293'
const APP_BUILD_HASH = 'c9156c3'
const CHANNEL = 'netease'
/** WEVNSM cookie，PC 客户端固定 1.0.0 */
const WEVNSM_VER = '1.0.0'

/** 上报用的歌曲信息（time 为秒，与上游一致） */
export interface WyReportSong {
  id: number
  name: string
  artist: string
  /** 网易音质档 level：standard/exhigh/lossless/hires/jyeffect/sky/jymaster/dolby */
  level: string
  /** 码率（kbps） */
  bitrate: number
  /** 时长（秒） */
  time: number
}

/** 播放来源（歌单/专辑等），sourceId 会同时嵌进 refer 串 */
export interface WyReportSource {
  id: string
  type: string
  name: string
}

// —— 持久化的 WNMCID（等同于一次安装的客户端标识，换一份等于换一台机器）——
let clientIdCache: string | null = null
function getClientId(): string {
  if (clientIdCache) return clientIdCache
  const path = appDataPath('wy_clientlog.txt')
  try {
    if (existsSync(path)) {
      const v = readFileSync(path, 'utf-8').trim()
      if (v) return (clientIdCache = v)
    }
  } catch {
    /* 读不到就重新生成 */
  }
  // 形如 lqdloz.1781634768551.01.0：6 位小写字母 + 毫秒时间戳 + 固定尾巴
  const letters = 'abcdefghijklmnopqrstuvwxyz'
  let prefix = ''
  for (let i = 0; i < 6; i++) prefix += letters[Math.floor(Math.random() * letters.length)]
  clientIdCache = `${prefix}.${Date.now()}.01.0`
  try {
    writeFileSync(path, clientIdCache)
  } catch {
    /* 存不下就每次现生成，只是少了跨启动的一致性 */
  }
  return clientIdCache
}

// —— 账号的 vipType（埋点字段，按会话缓存一次）——
let vipTypeCache: { musicU: string; vipType: string } | null = null
async function getVipType(musicU: string): Promise<string> {
  if (vipTypeCache?.musicU === musicU) return vipTypeCache.vipType
  const json = await eapiPost<any>('/api/nuser/account/get', {}, musicU).catch(() => null)
  // 取不到就这次按空串上报（埋点字段，不影响成败），但不缓存，下一首再试
  if (json?.code !== 200) return ''
  const vipType = String(json?.account?.vipType ?? '')
  vipTypeCache = { musicU, vipType }
  return vipType
}

function randomInt(max: number, min = 0): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

/** cookie 与 NCBL 元信息块共用的同一份键值（两处不一致会被当成异常请求） */
function buildIdentity(musicU: string): Record<string, string> {
  return {
    'JSESSIONID-WYYY': '',
    MUSIC_U: musicU,
    NMTID: '',
    WEVNSM: WEVNSM_VER,
    WNMCID: getClientId(),
    __csrf: '',
    _iuqxldmzr_: '33',
    _ntes_nnid: ',',
    _ntes_nuid: '',
    appver: `${APP_VERSION}.${APP_VERSION_CODE}`,
    channel: CHANNEL,
    clientSign: '',
    deviceId: getDeviceId(),
    mode: '',
    ntes_kaola_ad: '1',
    os: 'pc',
    osver: OS_VER
  }
}

/** `_plv`：开始播放 */
function buildPlv(song: WyReportSong, source: WyReportSource, vipType: string): object {
  const now = Date.now()
  const addRefer =
    `[F:63][${now}#933#${APP_VERSION}#${APP_VERSION_CODE}#${APP_BUILD_HASH}][e][2][23]` +
    `[cell_pc_songlist_song:2|page_pc_songlist_songflow|page_mine_like_music]` +
    `[${song.id}:song:x:x|:::|${source.id}:list::]`
  const multiRefers = [
    '[F:26][s][18][_ai]',
    '[F:26][s][12][_ai]',
    `[F:63][${now}#933#${APP_VERSION}#${APP_VERSION_CODE}#${APP_BUILD_HASH}][e][2][8]` +
      `[cell_pc_main_tab_entrance:6|page_pc_main_tab][我喜欢的音乐:spm::|:::]`,
    '[F:26][s][5][_ai]',
    '[F:26][s][0][_ai]'
  ]

  return {
    mode: 'circulation',
    download: 0,
    alg: '',
    status: 'front',
    id: String(song.id),
    bitrate: song.bitrate,
    type: 'song',
    is_listentogether: 0,
    source: source.name,
    is_heart: 0,
    resource_ratio: '',
    resource_time: song.time,
    musiceffect_id: '',
    app_mode: 2,
    bitrate_level: song.level,
    _addrefer: addRefer,
    _multirefers: multiRefers,
    vipType,
    fee: 1,
    file: 4,
    rightSource: 0,
    sourceId: source.id,
    sourcetype: source.type,
    libra_abt: '',
    channel: CHANNEL,
    curStartChannel: ''
  }
}

/** `_pld`：这一段播完/被打断，played 为实际播放秒数 */
function buildPld(
  song: WyReportSong,
  source: WyReportSource,
  played: number,
  vipType: string
): object {
  const now = Date.now()
  const addRefer =
    `[F:63][${now}#616#${APP_VERSION}#${APP_VERSION_CODE}#${APP_BUILD_HASH}][e][2][92]` +
    `[btn_pc_cover_play|cell_pc_songlist_song:6|page_pc_songlist_songflow|page_mine_like_music]` +
    `[:::|${song.id}:song:x:x|:::|${source.id}:list::]`
  const multiRefers = [
    '[F:26][s][87][_ai]',
    '[F:26][s][81][_ai]',
    '[F:26][s][75][_ai]',
    '[F:26][s][69][_ai]',
    '[F:26][s][63][_ai]'
  ]

  return {
    mode: 'circulation',
    download: 0,
    alg: '',
    status: 'front',
    id: String(song.id),
    time: played,
    type: 'song',
    is_listentogether: 0,
    source: source.name,
    is_heart: 0,
    realtime: played,
    resource_ratio: '',
    resource_time: song.time,
    musiceffect_id: '1001',
    app_mode: 1,
    lyriceffect: 'default',
    displayMode: 'classic',
    bitrate: song.bitrate,
    bitrate_level: song.level,
    _addrefer: addRefer,
    _multirefers: multiRefers,
    vipType,
    fee: 8,
    file: 4,
    rightSource: 0,
    sourceId: source.id,
    sourcetype: source.type,
    // 上游抓到的只有 interrupt 一种取值，自然播完也照发（服务端不靠它判完整播放）
    end: 'interrupt',
    libra_abt: '',
    channel: CHANNEL,
    curStartChannel: ''
  }
}

/** 上传文件名：op_<5 位随机>_<会话内自增>_<随机 u32>，服务端回包用它确认收下 */
let uploadSeq = 0
function buildFileName(): string {
  return `op_${randomInt(99999, 10000)}_${uploadSeq++}_${randomInt(4294967295, 1)}`
}

/**
 * multipart/form-data 手搓（form-data 包不在依赖里，这里只需要单个二进制字段）。
 * 字段名 file、filename 就是上面的 op_…，内层 Content-Type 照上游写 multipart/form-data。
 */
function buildMultipart(filename: string, payload: Buffer): { body: Buffer; boundary: string } {
  const boundary = randomUUID()
  const head =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
    `Content-Type: multipart/form-data\r\n\r\n`
  const tail = `\r\n--${boundary}--\r\n`
  return {
    body: Buffer.concat([Buffer.from(head, 'utf-8'), payload, Buffer.from(tail, 'utf-8')]),
    boundary
  }
}

/** 封包并上传一条埋点记录；成功的判据是回包的 successfiles 里有我们这次的文件名 */
async function upload(musicU: string, record: LogRecord): Promise<boolean> {
  const identity = buildIdentity(musicU)
  const payload = encryptNcbl({
    meta: JSON.stringify(identity),
    body: buildRecords([record])
  })
  const filename = buildFileName()
  const { body, boundary } = buildMultipart(filename, payload)
  const cookie = Object.entries(identity)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ')

  try {
    const json = await requestJson<any>(UPLOAD_URL, {
      method: 'POST',
      query: { multiupload: 'true' },
      headers: {
        Referer: 'https://music.163.com/di',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
          `Safari/537.36 Chrome/91.0.4472.164 NeteaseMusicDesktop/${APP_VERSION}`,
        'Accept-Language': 'zh-CN,zh;q=0.8',
        'Content-Type': `multipart/form-data; boundary=${boundary}`
      },
      cookie,
      body
    })
    const ok = json?.code === 200 && json?.data?.successfiles?.includes?.(filename) === true
    if (!ok) log.warn('听歌上报被拒', { action: record.action, code: json?.code })
    return ok
  } catch (e) {
    log.warn('听歌上报失败', { action: record.action, error: e })
    return false
  }
}

function hasLogin(cookie: string | undefined | null): string | null {
  if (!cookie) return null
  return extractMusicU(cookie) ?? cookie
}

/** 开始播放（`_plv`）。cookie 为 provider 凭据里的 `MUSIC_U=…`。 */
export async function wyReportPlayStart(
  cookie: string | undefined | null,
  song: WyReportSong,
  source: WyReportSource
): Promise<boolean> {
  const musicU = hasLogin(cookie)
  if (!musicU || !song.id) return false
  const vipType = await getVipType(musicU)
  return upload(musicU, {
    time: Math.floor(Date.now() / 1000),
    action: '_plv',
    data: buildPlv(song, source, vipType)
  })
}

/** 这一段播放结束（`_pld`），played 为实际播放秒数（≤0 不上报）。 */
export async function wyReportPlayEnd(
  cookie: string | undefined | null,
  song: WyReportSong,
  source: WyReportSource,
  played: number
): Promise<boolean> {
  const musicU = hasLogin(cookie)
  const sec = Math.floor(played)
  if (!musicU || !song.id || sec <= 0) return false
  const vipType = await getVipType(musicU)
  return upload(musicU, {
    time: Math.floor(Date.now() / 1000),
    action: '_pld',
    data: buildPld(song, source, sec, vipType)
  })
}

/** 网易音质档 → 埋点里的 level / 码率（码率只是埋点字段，按各档常见值取） */
const LEVEL_BY_QUALITY: Record<string, { level: string; bitrate: number }> = {
  '128k': { level: 'standard', bitrate: 128 },
  '320k': { level: 'exhigh', bitrate: 320 },
  flac: { level: 'lossless', bitrate: 999 },
  hires: { level: 'hires', bitrate: 1999 },
  atmos_plus: { level: 'jyeffect', bitrate: 1999 },
  atmos: { level: 'sky', bitrate: 1999 },
  master: { level: 'jymaster', bitrate: 1999 },
  dolby: { level: 'dolby', bitrate: 1999 }
}

/** 把播放中的曲目 + 音质档整成上报形状（duration 是毫秒，埋点要秒） */
export function toReportSong(item: NeteaseMusicItem, qualityId: string): WyReportSong {
  const q = LEVEL_BY_QUALITY[qualityId] ?? LEVEL_BY_QUALITY['320k']
  return {
    id: item.id,
    name: item.title,
    artist: item.artist,
    level: q.level,
    bitrate: q.bitrate,
    time: Math.max(0, Math.round(item.duration / 1000))
  }
}
