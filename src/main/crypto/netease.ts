/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 网易云加密核心（移植自 Android platform/wy/utils/NeteaseCrypto.kt）。
 * eapi：AES-128-ECB；weapi：两层 AES-128-CBC + 裸 RSA。数值 1:1 照源码。
 */
import { createCipheriv, createHash, randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { requestJson, requestRawWithHeaders } from '../net/request'
import { appDataPath } from '../core/paths'

const EAPI_KEY = 'e82ckenh8dichen8'
const WEAPI_PRESET_KEY = '0CoJUm6Qyw8W8jud'
const WEAPI_IV = '0102030405060708'

const RSA_N = BigInt(
  '0x00e0b509f6259df8642dbc35662901477df22677ec152b5ff68ace615bb7b725' +
    '152b3ab17a876aea8a5aa76d2e417629ec4ee341f56135fccf695280104e0312' +
    'ecbda92557c93870114af6c9d05c4f7f0c3685b7a46bee255932575cce10b424' +
    'd813cfe4875d3e82047b97ddef52741d546b8e289dc6935b3ece0462db0a22b8e7'
)
const RSA_E = 0x10001n

const APP_VER = '3.1.17.204416'
const VERSION_CODE = '140'
const OS_VER = 'Microsoft-Windows-10-Professional-build-19045-64bit'
const RESOLUTION = '1920x1080'
const CHANNEL = 'netease'

const EAPI_HEADERS: Record<string, string> = {
  'User-Agent': 'NeteaseMusic 9.0.90/5038 (iPhone; iOS 16.2; zh_CN)',
  Accept: 'application/json, text/plain, */*'
}
const WEAPI_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0',
  Referer: 'https://music.163.com/'
}
const FORM = 'application/x-www-form-urlencoded'

// —— 底层 ——
function md5Hex(s: string): string {
  return createHash('md5').update(s, 'utf-8').digest('hex')
}
function aesEcb(text: string, key: string): Buffer {
  const c = createCipheriv('aes-128-ecb', Buffer.from(key, 'utf-8'), null)
  return Buffer.concat([c.update(Buffer.from(text, 'utf-8')), c.final()])
}
function aesCbcBase64(text: string, key: string | Buffer): string {
  const k = typeof key === 'string' ? Buffer.from(key, 'utf-8') : key
  const c = createCipheriv('aes-128-cbc', k, Buffer.from(WEAPI_IV, 'utf-8'))
  return Buffer.concat([c.update(Buffer.from(text, 'utf-8')), c.final()]).toString('base64')
}
function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n
  base %= mod
  while (exp > 0n) {
    if (exp & 1n) result = (result * base) % mod
    exp >>= 1n
    base = (base * base) % mod
  }
  return result
}
function rsaEncryptHex(text: string): string {
  const bytes = Buffer.from(text, 'utf-8')
  const padded = Buffer.alloc(128)
  bytes.copy(padded, 128 - bytes.length) // 右对齐，左侧补 0
  let m = 0n
  for (const b of padded) m = (m << 8n) | BigInt(b)
  return modPow(m, RSA_E, RSA_N).toString(16).padStart(256, '0')
}
function randomSecKey(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  return Array.from(randomBytes(16))
    .map((b) => chars[b % 36])
    .join('')
}

// —— deviceId（52 位大写 hex，持久化复用）——
let deviceIdCache: string | null = null
function getDeviceId(): string {
  if (deviceIdCache) return deviceIdCache
  const path = appDataPath('wy_device.txt')
  try {
    if (existsSync(path)) {
      const v = readFileSync(path, 'utf-8').trim()
      if (v) return (deviceIdCache = v)
    }
  } catch {
    /* ignore */
  }
  const chars = '0123456789ABCDEF'
  deviceIdCache = Array.from(randomBytes(52))
    .map((b) => chars[b % 16])
    .join('')
  try {
    writeFileSync(path, deviceIdCache)
  } catch {
    /* ignore */
  }
  return deviceIdCache
}

function buildEapiHeader(musicU?: string): Record<string, string> {
  const now = Math.floor(Date.now() / 1000)
  const rand = String(Math.floor(Math.random() * 10000)).padStart(4, '0')
  const h: Record<string, string> = {
    osver: OS_VER,
    deviceId: getDeviceId(),
    os: 'pc',
    appver: APP_VER,
    versioncode: VERSION_CODE,
    mobilename: '',
    buildver: String(now),
    resolution: RESOLUTION,
    __csrf: '',
    channel: CHANNEL,
    requestId: `${now}_${rand}`
  }
  if (musicU) h.MUSIC_U = musicU
  return h
}

/** 从 cookie 提取 MUSIC_U，提不到返回 null */
export function extractMusicU(cookie: string): string | null {
  const m = /MUSIC_U=([^;\s]+)/.exec(cookie)
  return m ? m[1] : null
}

/** eapi 请求（返回 body JSON + 响应 Set-Cookie，供需要读登录 cookie 的轮询用）。 */
export async function eapiPostRaw<T = any>(
  path: string,
  data: unknown,
  musicU?: string
): Promise<{ json: T; setCookie: string[] }> {
  const header = buildEapiHeader(musicU)
  const base = typeof data === 'string' ? JSON.parse(data) : { ...(data as object) }
  const params = JSON.stringify({ ...base, header })
  const digest = md5Hex(`nobody${path}use${params}md5forencrypt`)
  const payload = `${path}-36cd479b6b5-${params}-36cd479b6b5-${digest}`
  const enc = aesEcb(payload, EAPI_KEY).toString('hex').toUpperCase()
  const url = `https://interface3.music.163.com/eapi${path.replace(/^\/api/, '')}`
  const cookie = Object.entries(header)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ')
  const resp = await requestRawWithHeaders(url, {
    method: 'POST',
    headers: { ...EAPI_HEADERS, 'Content-Type': FORM, Cookie: cookie },
    body: `params=${enc}`
  })
  const json = JSON.parse(resp.body.toString('utf-8')) as T
  const sc = resp.headers['set-cookie']
  const setCookie = Array.isArray(sc) ? sc : sc ? [sc] : []
  return { json, setCookie }
}

/** eapi 请求。path 为带 /api 的完整内部路径。 */
export async function eapiPost<T = any>(path: string, data: unknown, musicU?: string): Promise<T> {
  const { json } = await eapiPostRaw<T>(path, data, musicU)
  return json
}

/** weapi 请求。 */
export async function weapiPost<T = any>(path: string, data: unknown, musicU?: string): Promise<T> {
  const params = typeof data === 'string' ? data : JSON.stringify(data)
  const secKey = randomSecKey()
  const step1 = aesCbcBase64(params, WEAPI_PRESET_KEY)
  const step2 = aesCbcBase64(step1, secKey)
  const encSecKey = rsaEncryptHex(secKey.split('').reverse().join(''))
  const url = `https://music.163.com/weapi${path.replace(/^\/api/, '')}`
  const cookie = musicU ? `os=pc; MUSIC_U=${musicU}` : 'os=pc'
  const body = `params=${encodeURIComponent(step2)}&encSecKey=${encodeURIComponent(encSecKey)}`
  return requestJson<T>(url, {
    method: 'POST',
    headers: { ...WEAPI_HEADERS, 'Content-Type': FORM, Cookie: cookie },
    body
  })
}
