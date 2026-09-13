/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 酷狗 thirdsso（车机 SDK）接口层，1:1 移植 Android `platform/kg/KgThirdsso.kt`
 * 与 native `cpp/KgCrypto/KgCrypto.cpp`。
 *
 * 这套接口用于扫码登录、用户信息与「我的歌单」，与 provider 里搜索/专辑走的
 * 老 web 接口（sign.ts 的 kgSign）完全是两套签名：
 * - kgidentity = base64( HMAC-SHA256( key = MD5_raw(SIGNING_KEY), body ) )
 * - signature  = hex( MD5( body + SIGNING_KEY ) )
 * - signtrial  = hex( HMAC-SHA256( key = SIGNING_KEY, body ) )
 *
 * 三个头都对**同一份 body 字符串**求值，故请求体必须先序列化成字符串再签名与发送，
 * 不能交给请求层二次序列化（键序/空格不同 → 签名对不上）。
 */
import { createHash, createHmac, randomUUID } from 'node:crypto'
import { requestJson } from '../../net/request'

const SIGNING_KEY = '9046ad4ecae74a70aa750c1bb2307ae6'
const UA = 'Android12-androidCar-155-e4b4136-203051-0-UltimateSdk-wifi'
const CLIENT_VER = '155-e4b4136-20250923120802'
/** getNonce 用的固定命名空间串（RFC4122 DNS namespace 的字面量） */
const NONCE_NS = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'

/** 酷狗凭据（对应 KgCredentials.kt） */
export interface KgCreds {
  userid: string
  token: string
  mid?: string
  dfid?: string
  deviceId: string
}

export function kgGenerateDeviceId(): string {
  return randomUUID().replace(/-/g, '')
}

// —— 三个签名（KgCrypto.cpp 的 JNI 导出）——

export function kgIdentity(body: string): string {
  const keyMd5 = createHash('md5').update(SIGNING_KEY, 'utf-8').digest()
  return createHmac('sha256', keyMd5).update(body, 'utf-8').digest('base64')
}

export function kgSignature(body: string): string {
  return createHash('md5')
    .update(Buffer.concat([Buffer.from(body, 'utf-8'), Buffer.from(SIGNING_KEY, 'utf-8')]))
    .digest('hex')
}

export function kgTrialSignature(body: string): string {
  return createHmac('sha256', SIGNING_KEY).update(body, 'utf-8').digest('hex')
}

/**
 * nonce：SHA1( UUIDv3 命名空间的 16 字节 ‖ 一个随机数的十进制串 )。
 * 对应 Kotlin 的 UUID.nameUUIDFromBytes(NONCE_NS)——即 MD5(NONCE_NS) 后按 v3 打上版本位。
 */
function getNonce(): string {
  const md5 = createHash('md5').update(NONCE_NS, 'utf-8').digest()
  md5[6] = (md5[6] & 0x0f) | 0x30 // version 3
  md5[8] = (md5[8] & 0x3f) | 0x80 // IETF variant
  return createHash('sha1')
    .update(Buffer.concat([md5, Buffer.from(String(Math.random()), 'utf-8')]))
    .digest('hex')
}

/** 服务端要求带上客户端公网 IP；user/ip 自己就能查，查到后全局缓存 */
let cachedIp: string | null = null

async function rawRequest(
  path: string,
  creds: KgCreds,
  clientIp: string,
  params: Record<string, unknown> = {},
  extraHeaders: Record<string, string> = {}
): Promise<any | null> {
  const body = JSON.stringify({
    package: 'com.kugou.android.auto',
    device_id: creds.deviceId,
    pid: '203051',
    apk_ver: '10200',
    sha1: '35D2D23C98CB8B9CFEFF20E5909E34206D906172',
    device_info: {
      resolution_height: 1600,
      resolution_width: 900,
      api_level: 32,
      device_level: 2,
      memory_size: 5.8095703
    },
    sp: 'KG',
    client_ver: CLIENT_VER,
    client_ip: clientIp,
    nonce: getNonce(),
    timestamp: Math.floor(Date.now() / 1000),
    ...params
  })

  return requestJson<any>(`https://thirdsso.kugou.com/v2/${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'User-Agent': UA,
      kgidentity: kgIdentity(body),
      signature: kgSignature(body),
      signtrial: kgTrialSignature(body),
      ...extraHeaders
    },
    body
  }).catch(() => null)
}

async function getClientIp(creds: KgCreds): Promise<string> {
  if (cachedIp) return cachedIp
  const resp = await rawRequest('user/ip', creds, '127.0.0.1')
  const ip = resp?.data?.ip
  if (typeof ip === 'string' && ip) cachedIp = ip
  return typeof ip === 'string' ? ip : ''
}

/** thirdsso 请求（自动带上客户端 IP）。失败/非法返回 null。 */
export async function kgRequest(
  path: string,
  creds: KgCreds,
  params: Record<string, unknown> = {},
  extraHeaders: Record<string, string> = {}
): Promise<any | null> {
  const ip = await getClientIp(creds)
  return rawRequest(path, creds, ip, params, extraHeaders)
}

/** 带 userid/token 的请求（读接口都要求登录态） */
export async function kgAuthedRequest(
  path: string,
  creds: KgCreds,
  params: Record<string, unknown> = {},
  extraHeaders: Record<string, string> = {}
): Promise<any | null> {
  return kgRequest(
    path,
    creds,
    { userid: creds.userid, token: creds.token, ...params },
    extraHeaders
  )
}

/** 匿名凭据：设备注册与二维码流程用的 userid/token 是固定占位值 */
export function kgAnonymousCreds(deviceId = kgGenerateDeviceId()): KgCreds {
  return { userid: 'anonymous', token: 'password', deviceId }
}

// ===== 用户信息 =====

export interface KgUserInfo {
  nickname: string
  avatar: string
  /** 会员等级文案（「超级会员」/「普通」） */
  vipType: string
  userid: string
}

export async function kgFetchUserInfo(creds: KgCreds): Promise<KgUserInfo | null> {
  const resp = await kgAuthedRequest(
    'vip/client/ssov2/userinfo',
    creds,
    { extend: 1 },
    { url_code: '1005' }
  )
  if (resp?.error_code !== 0 || !resp.data) return null
  const d = resp.data
  return {
    nickname: d.nick_name ?? '',
    avatar: d.img ?? '',
    vipType: d.is_su_vip === 1 ? '超级会员' : '普通',
    userid: creds.userid
  }
}

/**
 * 换新 token（对应 refreshLogin）。服务端 `refresh=false` 时表示无需更换，
 * 原样返回旧凭据；失败返回 null。
 */
export async function kgRefreshToken(creds: KgCreds): Promise<KgCreds | null> {
  const resp = await kgAuthedRequest('user/refresh/tokenv2', creds)
  if (resp?.error_code !== 0 || !resp.data) return null
  if (!resp.data.refresh) return creds
  return {
    ...creds,
    userid: resp.data.userid ?? creds.userid,
    token: resp.data.token ?? creds.token
  }
}
