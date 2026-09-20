/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * QQ 音乐听歌上报（移植自 Android QQProvider 的三段上报）：
 *
 * - ListeningMusicReport：听歌记录，影响推荐算法（musics.fcg，签名）
 * - ReportPlayRecentlyInfo：同步到 QQ 音乐客户端的「最近播放」（musicu.fcg?cgiKey=…）
 * - imusic_tj 播放流水：听歌时长统计（stat6，gzip XML）
 *
 * 全部要求登录态；设备指纹 / QIMEI 由 device.ts 提供并持久化，保证同一安装上报一致。
 * 调用方只在 QQ 曲目播放时触发，任何失败都静默返回 false，绝不影响播放。
 */
import { createHash, randomInt } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import type { QQMusicItem } from '@common'
import { drainResponse, requestJson, requestRaw } from '../../net/request'
import { zzcRequest } from './index'
import { qqComm, qqLoginType } from './comm'
import { ensureQimeiReady, getQQDevice } from './device'

/** 用 type 而非 interface：接口没有隐式索引签名，传不进 qqComm 的松散凭据形状 */
export type QQReportCreds = {
  uin: string
  authst: string
  openid?: string
  accessToken?: string
  expiredAt?: number
}

const RECENTLY_URL = 'https://u6.y.qq.com/cgi-bin/musicu.fcg?cgiKey=ReportPlayRecentlyInfo'
const STAT_URL = 'https://stat6.y.qq.com/android/fcgi-bin/imusic_tj'
const TIMEKEY_SALT = 'gk2$Lh-&l4#!4iow'

function md5Hex(s: string): string {
  return createHash('md5').update(s, 'utf-8').digest('hex')
}
function randomDigits(n: number): string {
  let s = ''
  for (let i = 0; i < n; i++) s += randomInt(10)
  return s
}
function randomHex(n: number): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let s = ''
  for (let i = 0; i < n; i++) s += chars[randomInt(chars.length)]
  return s
}
function hasLogin(creds: QQReportCreds | null | undefined): creds is QQReportCreds {
  return !!creds?.uin && !!creds.authst
}

/**
 * 听歌记录上报。
 * @param playTimeMs 实际播放位置/时长（毫秒）
 * @param playList 当前队列里所有 QQ 曲目的 songId
 */
export async function qqReportListening(
  creds: QQReportCreds | null | undefined,
  song: QQMusicItem,
  playTimeMs: number,
  playList: number[]
): Promise<boolean> {
  if (!hasLogin(creds) || !song.mid) return false
  await ensureQimeiReady()
  // 该接口在设备 comm 之外还要 guid/patch（对齐 Android reportListening）
  const comm = qqComm('report', creds, { guid: '1F70E520B2EAA7D25E11760783C53CA9', patch: '118' })
  const playTime = Math.max(0, Math.round(playTimeMs))
  try {
    const json = await zzcRequest<any>({
      comm,
      'music.richFlag.listening.ListeningMusicReport': {
        method: 'ListeningMusicReport',
        module: 'music.richFlag.listening',
        param: {
          pauseFlag: false,
          playList,
          remainingTime: playTime,
          songPlayTime: playTime,
          songid: 0,
          songmid: song.mid,
          songtype: 1,
          speed: 1
        }
      }
    })
    return Number(json?.code) === 0
  } catch {
    return false
  }
}

/** 「最近播放」上报：先按 Android 走无签名 musicu.fcg，失败再试签名的 musics.fcg */
export async function qqReportPlayRecently(
  creds: QQReportCreds | null | undefined,
  song: QQMusicItem
): Promise<boolean> {
  if (!hasLogin(creds) || !song.id) return false
  await ensureQimeiReady()
  const body = {
    comm: qqComm('report', creds),
    'music.musicasset.PlayRecentlyWrite.ReportPlayRecentlyInfo': {
      module: 'music.musicasset.PlayRecentlyWrite',
      method: 'ReportPlayRecentlyInfo',
      param: {
        data: [
          {
            id: String(song.id),
            type: 2,
            lastTime: Math.floor(Date.now() / 1000),
            listenCnt: 1,
            auxillaryID: song.albumId && song.albumId !== '0' ? song.albumId : '0',
            auxillaryDict: { vip: '1' }
          }
        ]
      }
    }
  }
  const ok = (json: any): boolean => Number(json?.code) === 0
  try {
    const json = await requestJson<any>(RECENTLY_URL, {
      method: 'POST',
      headers: {
        'User-Agent': 'QQMusic/2104583050',
        'Content-Type': 'application/json',
        Referer: 'https://y.qq.com/'
      },
      body
    })
    if (ok(json)) return true
  } catch {
    /* 走签名通道重试 */
  }
  try {
    return ok(await zzcRequest<any>(body))
  } catch {
    return false
  }
}

/** 播放流水上报（imusic_tj）：gzip 压缩的 XML，用于听歌时长统计 */
export async function qqReportPlayStream(
  creds: QQReportCreds | null | undefined,
  song: QQMusicItem,
  playTimeSec: number
): Promise<boolean> {
  if (!hasLogin(creds) || !song.id) return false
  const sec = Math.floor(playTimeSec)
  if (sec <= 0) return false
  await ensureQimeiReady()
  const timestamp = Math.floor(Date.now() / 1000)
  const timeStr = String(sec)
  const timekey = md5Hex(`${timestamp}${timeStr}${creds.uin}${TIMEKEY_SALT}`).toUpperCase()
  const uid = randomDigits(10)
  const xml = buildStatXml(song, creds, timestamp, timeStr, timekey, uid)
  try {
    const resp = await requestRaw(STAT_URL, {
      method: 'POST',
      headers: {
        'User-Agent': 'QQMusic 12030508(android 12)',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Encoding': 'gzip'
      },
      body: gzipSync(Buffer.from(xml, 'utf-8'))
    })
    // 上报只关心状态码。body 不收就是一条永远挂在 Chromium 连接池里的孤儿连接——
    // 每播一首歌漏一条，攒满之后取流也申请不到额度（见 drainResponse）。
    drainResponse(resp)
    return resp.ok
  } catch {
    return false
  }
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function buildStatXml(
  song: QQMusicItem,
  creds: QQReportCreds,
  timestamp: number,
  time: string,
  timekey: string,
  uid: string
): string {
  const dev = getQQDevice()
  const openUDID = dev.open_udid2
  const aid = dev.android_id
  const qimei36 = dev.qimei?.q36 ?? ''
  const phoneType = dev.model
  const osVer = dev.version.release
  const deviceLevel = dev.version.sdk
  // 会话级随机字段（非持久设备指纹）
  const taid = randomHex(88)
  const tid = randomDigits(19)
  const d = new Date()
  const sid =
    `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}` +
    `${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}${uid}`
  const traceid = `11_${randomDigits(11)}_${timestamp}`
  const vkey = randomHex(32)
  const v4ip = `${randomInt(1, 224)}.${randomInt(0, 256)}.${randomInt(0, 256)}.${randomInt(1, 255)}`
  const loginType = qqLoginType(creds.authst)
  const playDurationMi = String(Number(time) * 1000)

  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<root>' +
    `<OpenUDID>${openUDID}</OpenUDID>` +
    `<udid>${openUDID}</udid>` +
    '<ct>11</ct><cv>12030508</cv><v>12030508</v>' +
    `<chid>74648</chid><os_ver>${osVer}</os_ver>` +
    `<aid>${aid}</aid><phonetype>${phoneType}</phonetype>` +
    `<devicelevel>${deviceLevel}</devicelevel><newdevicelevel>${deviceLevel}</newdevicelevel>` +
    '<deviceScore>800.0</deviceScore>' +
    `<QIMEI36>${qimei36}</QIMEI36>` +
    `<taid>${taid}</taid>` +
    `<tmeAppID>qqmusic</tmeAppID><tid>${tid}</tid>` +
    '<modeSwitch>6</modeSwitch><teenMode>0</teenMode>' +
    `<uid>${uid}</uid><sid>${sid}</sid>` +
    `<OpenUDID2>${openUDID}</OpenUDID2>` +
    '<ui_mode>1</ui_mode><nettype>1030</nettype>' +
    `<tmeLoginType>${loginType}</tmeLoginType><tmeLoginMethod>2</tmeLoginMethod>` +
    `<fPersonality>0</fPersonality><wid>${uid}</wid>` +
    `<v4ip>${v4ip}</v4ip>` +
    `<qq>${creds.uin}</qq>` +
    `<authst>${creds.authst}</authst>` +
    `<psrf_qqopenid>${creds.openid ?? ''}</psrf_qqopenid>` +
    `<psrf_access_token_expiresAt>${creds.expiredAt ?? 0}</psrf_access_token_expiresAt>` +
    `<psrf_qqaccess_token>${creds.accessToken ?? ''}</psrf_qqaccess_token>` +
    '<hotfix>100000000</hotfix>' +
    `<traceid>${traceid}</traceid>` +
    '<cid>228</cid>' +
    `<item cmd="1" optime="${timestamp}" nettype="1030" ` +
    `QQ="${creds.uin}" uid="${uid}" os="${osVer}" model="${phoneType}" ` +
    'version="12.3.5.8" songtype="1" playtype="4" ' +
    'from="1,132,151," dts="0" openstore="0" crytype="5" ' +
    'paytype="3" desktoplyric="0" playdevice="0" ' +
    'playlist_mode="0" outdev="0" url="26" playmode="1" ' +
    'repeat_times="0" cdn="" cdnip="" ' +
    'hasFirstBuffer="1" hijackflag="0" filetype="4" ' +
    `err="0" size="0" time="${time}" retry="0" ` +
    'issoftdecode="1" component_type="2" ' +
    'bandwidth_policy="0" secondCacheCount="0" ' +
    'wait_time="0" player_retry="0" ' +
    `audiotime="${song.duration}" ` +
    `timekey="${timekey}" ` +
    `vkey="${vkey}" ` +
    `play_duration_mi="${playDurationMi}" ` +
    'play_speed="1.0" vip_level="65552" ' +
    'audio_effect="0:0" ' +
    `songid="${song.id}" singerid="0" fversion="0"/>` +
    '</root>'
  )
}
