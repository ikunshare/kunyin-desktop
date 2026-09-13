/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * QQ 音乐虚拟设备指纹 + QIMEI（移植自 Android platform/qq/device/*）。
 *
 * 听歌上报要求请求携带一致的设备信息（OpenUDID / AndroidID / MValue / QIMEI36），
 * 否则会被判为异常流量。设备在首次需要时随机生成一份，持久化到 data/qq_device.json，
 * 此后整个安装实例共用；QIMEI 联网获取一次并回写，失败则用固定值兜底，不阻塞上报。
 *
 * 这里只负责「设备」本身；把设备字段拼进请求 comm 的逻辑在 comm.ts。
 */
import {
  constants as cryptoConstants,
  createCipheriv,
  createHash,
  publicEncrypt,
  randomBytes,
  randomInt,
  randomUUID
} from 'node:crypto'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { appDataPath } from '../../core/paths'
import { requestJson } from '../../net/request'

export interface QQOSVersion {
  incremental: string
  release: string
  codename: string
  sdk: number
}
export interface QimeiResult {
  q16: string
  q36: string
}
export interface QQDevice {
  display: string
  product: string
  device: string
  board: string
  model: string
  fingerprint: string
  boot_id: string
  proc_version: string
  imei: string
  brand: string
  bootloader: string
  base_band: string
  version: QQOSVersion
  sim_info: string
  os_type: string
  mac_address: string
  wifi_bssid: string
  wifi_ssid: string
  imsi_md5: number[]
  android_id: string
  apn: string
  vendor_name: string
  vendor_os_name: string
  qimei?: QimeiResult | null
  open_udid2: string
  m_value: string
}

const ID_CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
const QIMEI_APP_VERSION = '14.9.0.8'
const DEFAULT_Q36 = '6c9d3cd110abca9b16311cee10001e717614'

function randomString(n: number): string {
  let s = ''
  for (let i = 0; i < n; i++) s += ID_CHARS[randomInt(ID_CHARS.length)]
  return s
}

/** 符合 Luhn 校验的 15 位 IMEI（对齐后端 randomIMEI） */
function randomIMEI(): string {
  const digits: number[] = new Array(15).fill(0)
  let sum = 0
  for (let i = 0; i < 14; i++) {
    let n = randomInt(10)
    if ((i + 2) % 2 === 0) {
      n *= 2
      if (n >= 10) n = (n % 10) + 1
    }
    sum += n
    digits[i] = n
  }
  digits[14] = (sum * 9) % 10
  return digits.join('')
}

/** Java String.hashCode（int32 溢出语义） */
function javaHashCode(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
  return h
}

/**
 * 模拟 QQ SDK 的 OpenUDID 算法：AndroidID.hashCode 与设备信息 hashCode + 时间戳拼接。
 * int32 符号扩展为 int64 后按位取段，与 Android/后端实现保持一致，这里用 BigInt 复刻。
 */
function generateOpenUDID2(dev: QQDevice): string {
  const info = [
    dev.display,
    dev.product,
    dev.device,
    dev.board,
    dev.model,
    dev.fingerprint,
    dev.boot_id,
    dev.proc_version,
    dev.imei,
    dev.brand,
    dev.bootloader,
    dev.base_band,
    dev.version.incremental,
    dev.version.release,
    dev.version.codename,
    String(dev.version.sdk),
    dev.sim_info,
    dev.os_type,
    dev.mac_address,
    dev.wifi_bssid,
    dev.wifi_ssid,
    dev.android_id,
    dev.apn,
    dev.vendor_name,
    dev.vendor_os_name
  ].join('')
  const mask64 = (1n << 64n) - 1n
  const most = BigInt(javaHashCode(dev.android_id)) & mask64
  const least = (BigInt(javaHashCode(info)) | BigInt(Date.now())) & mask64
  const hex = (v: bigint, width: number): string => v.toString(16).padStart(width, '0')
  return (
    hex(most & 0xffffffffn, 8) +
    hex((most >> 32n) & 0xffffn, 4) +
    hex((most >> 48n) & 0xffffn, 4) +
    hex((least >> 48n) & 0xffffn, 4) +
    hex(least & 0xffffffffffffn, 12)
  )
}

// ============ OICQ TEA（MValue） ============

const TEA_DELTA = 0x9e3779b9

function teaEncryptBlock(block: Buffer, key: Buffer): Buffer {
  let v0 = block.readUInt32BE(0)
  let v1 = block.readUInt32BE(4)
  const k0 = key.readUInt32BE(0)
  const k1 = key.readUInt32BE(4)
  const k2 = key.readUInt32BE(8)
  const k3 = key.readUInt32BE(12)
  let sum = 0
  for (let i = 0; i < 16; i++) {
    sum = (sum + TEA_DELTA) >>> 0
    v0 = (v0 + ((((v1 << 4) + k0) ^ (v1 + sum) ^ ((v1 >>> 5) + k1)) >>> 0)) >>> 0
    v1 = (v1 + ((((v0 << 4) + k2) ^ (v0 + sum) ^ ((v0 >>> 5) + k3)) >>> 0)) >>> 0
  }
  const out = Buffer.alloc(8)
  out.writeUInt32BE(v0, 0)
  out.writeUInt32BE(v1, 4)
  return out
}

/** QQ 经典带随机填充的 TEA 流加密（头字节记录填充长度，CBC 变体） */
function oicqTeaEncrypt(plain: Buffer, key: Buffer): Buffer {
  let fill = (plain.length + 10) % 8
  if (fill !== 0) fill = 8 - fill
  const parts: number[] = []
  parts.push((randomInt(256) & 0xf8) | fill)
  for (let i = 0; i < fill; i++) parts.push(randomInt(256))
  parts.push(randomInt(256), randomInt(256))
  for (const b of plain) parts.push(b)
  for (let i = 0; i < 7; i++) parts.push(0)
  const data = Buffer.from(parts)
  const teaKey = Buffer.alloc(16)
  key.copy(teaKey, 0, 0, Math.min(16, key.length))
  const out = Buffer.alloc(data.length)
  let tPrev = Buffer.alloc(8)
  let cPrev = Buffer.alloc(8)
  for (let i = 0; i < data.length / 8; i++) {
    const block = data.subarray(i * 8, i * 8 + 8)
    const tI = Buffer.from(block.map((b, j) => b ^ cPrev[j]))
    const enc = teaEncryptBlock(tI, teaKey)
    const cI = Buffer.from(enc.map((b, j) => b ^ tPrev[j]))
    cI.copy(out, i * 8)
    tPrev = tI
    cPrev = cI
  }
  return out
}

function generateMValue(androidId: string): string {
  const plain = Buffer.from('{"did":null,"mcc":null,"mnc":null}', 'utf-8')
  return oicqTeaEncrypt(plain, Buffer.from(androidId, 'utf-8')).toString('base64')
}

// ============ 设备生成 / 持久化 ============

function createDevice(): QQDevice {
  const dev: QQDevice = {
    display: `QMAPI.${randomInt(100000, 1000000)}.001`,
    product: 'iarim',
    device: 'sagit',
    board: 'eomam',
    model: 'MI 6',
    fingerprint: `xiaomi/iarim/sagit:10/eomam.200122.001/${randomInt(1000000, 10000000)}:user/release-keys`,
    boot_id: randomUUID(),
    proc_version: `Linux 5.4.0-54-generic-${randomString(8)} (android-build@google.com)`,
    imei: randomIMEI(),
    brand: 'Xiaomi',
    bootloader: 'U-boot',
    base_band: '',
    version: { incremental: '5891938', release: '10', codename: 'REL', sdk: 29 },
    sim_info: 'T-Mobile',
    os_type: 'android',
    mac_address: '00:50:56:C0:00:08',
    wifi_bssid: '00:50:56:C0:00:08',
    wifi_ssid: '<unknown ssid>',
    imsi_md5: [...createHash('md5').update(randomBytes(16)).digest()],
    android_id: randomBytes(8).toString('hex'),
    apn: 'wifi',
    vendor_name: 'MIUI',
    vendor_os_name: 'qmapi',
    qimei: null,
    open_udid2: '',
    m_value: ''
  }
  dev.open_udid2 = generateOpenUDID2(dev)
  dev.m_value = generateMValue(dev.android_id)
  return dev
}

function devicePath(): string {
  return appDataPath('qq_device.json')
}

let device: QQDevice | null = null

function saveDevice(dev: QQDevice): void {
  try {
    const path = devicePath()
    const tmp = `${path}.tmp`
    writeFileSync(tmp, JSON.stringify(dev))
    renameSync(tmp, path)
  } catch {
    /* 写失败下次启动会重新生成，只影响设备一致性 */
  }
}

/** 当前设备；首次访问时生成并持久化 */
export function getQQDevice(): QQDevice {
  if (device) return device
  try {
    if (existsSync(devicePath())) {
      const parsed = JSON.parse(readFileSync(devicePath(), 'utf-8')) as QQDevice
      if (parsed?.android_id && parsed.open_udid2 && parsed.m_value) {
        device = parsed
        return parsed
      }
    }
  } catch {
    /* 损坏则重新生成 */
  }
  device = createDevice()
  saveDevice(device)
  return device
}

// ============ QIMEI ============

const QIMEI_SECRET = 'ZdJqM15EeO2zWc08'
const QIMEI_APP_KEY = '0AND0HD6FE4HY80F'
const QIMEI_PROXY_URL = 'https://api.tencentmusic.com/tme/trpc/proxy'
const QIMEI_PUB_KEY = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDEIxgwoutfwoJxcGQeedgP7FG9
qaIuS0qzfR8gWkrkTZKM2iWHn2ajQpBRZjMSoSf6+KJGvar2ORhBfpDXyVtZCKp
qLQ+FLkpncClKVIrBwv6PHyUvuCb0rIarmgDnzkfQAqVufEtR64iazGDKatvJ9y
6B9NMbHddGSAUmRTCrHQIDAQAB
-----END PUBLIC KEY-----`

function md5Hex(s: string): string {
  return createHash('md5').update(s, 'utf-8').digest('hex')
}
function pad2(n: number): string {
  return String(n).padStart(2, '0')
}
function formatDate(d: Date, withTime: boolean): string {
  const date = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
  if (!withTime) return date
  return `${date} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
}

function randomBeaconId(now: number): string {
  const timeMonth = `${formatDate(new Date(now), false).slice(0, 8)}01`
  const rand1 = randomInt(100000, 1000000)
  const rand2 = randomInt(100000000, 1000000000)
  const special = new Set([1, 2, 13, 14, 17, 18, 21, 22, 25, 26, 29, 30, 33, 34, 37, 38])
  let sb = ''
  for (let i = 1; i <= 40; i++) {
    if (special.has(i)) sb += `k${i}:${timeMonth}${rand1}.${rand2}`
    else if (i === 3) sb += 'k3:0000000000000000'
    else if (i === 4) {
      const chars = '123456789abcdef'
      let s = ''
      for (let j = 0; j < 16; j++) s += chars[randomInt(chars.length)]
      sb += `k4:${s}`
    } else sb += `k${i}:${randomInt(10000)}`
    sb += ';'
  }
  return sb
}

function buildQimeiPayload(dev: QQDevice, now: number): Record<string, unknown> {
  const reserved = {
    harmony: '0',
    clone: '0',
    containe: '',
    oz: 'UhYmelwouA+V2nPWbOvLTgN2/m8jwGB+yUB5v9tysQg=',
    oo: 'Xecjt+9S1+f8Pz2VLSxgpw==',
    kelong: '0',
    uptimes: formatDate(new Date(now - randomInt(14401) * 1000), true),
    multiUser: '0',
    bod: dev.brand,
    dv: dev.device,
    firstLevel: '',
    manufact: dev.brand,
    name: dev.model,
    host: 'se.infra',
    kernel: dev.proc_version
  }
  return {
    androidId: dev.android_id,
    platformId: 1,
    appKey: QIMEI_APP_KEY,
    appVersion: QIMEI_APP_VERSION,
    beaconIdSrc: randomBeaconId(now),
    brand: dev.brand,
    channelId: '10003505',
    cid: '',
    imei: dev.imei,
    imsi: '',
    mac: '',
    model: dev.model,
    networkType: 'unknown',
    oaid: '',
    osVersion: `Android ${dev.version.release},level ${dev.version.sdk}`,
    qimei: '',
    qimei36: '',
    sdkVersion: '1.2.13.6',
    targetSdkVersion: '33',
    audit: '',
    userId: '{}',
    packageId: 'com.tencent.qqmusic',
    deviceType: 'Phone',
    sdkName: '',
    reserved: JSON.stringify(reserved)
  }
}

function randomCryptKey(): Buffer {
  const chars = 'adbcdef1234567890'
  const out = Buffer.alloc(16)
  for (let i = 0; i < 16; i++) out[i] = chars.charCodeAt(randomInt(chars.length))
  return out
}

async function fetchQimei(dev: QQDevice): Promise<QimeiResult | null> {
  const now = Date.now()
  const tsSec = Math.floor(now / 1000)
  const cryptKey = randomCryptKey()
  const key = publicEncrypt(
    { key: QIMEI_PUB_KEY, padding: cryptoConstants.RSA_PKCS1_PADDING },
    cryptKey
  ).toString('base64')
  // AES/CBC，密钥同时作 IV（对齐后端）
  const cipher = createCipheriv('aes-128-cbc', cryptKey, cryptKey)
  const params = Buffer.concat([
    cipher.update(Buffer.from(JSON.stringify(buildQimeiPayload(dev, now)), 'utf-8')),
    cipher.final()
  ]).toString('base64')
  const nonce = randomCryptKey().toString('latin1')
  const extra = `{"appKey":"${QIMEI_APP_KEY}"}`
  const sign = md5Hex(key + params + String(tsSec * 1000) + nonce + QIMEI_SECRET + extra)
  const headerSign = md5Hex(`qimei_qq_androidpzAuCmaFAaFaHrdakPjLIEqKrGnSOOvH${tsSec}`)
  const json = await requestJson<any>(QIMEI_PROXY_URL, {
    method: 'POST',
    headers: {
      method: 'GetQimei',
      service: 'trpc.tme_datasvr.qimeiproxy.QimeiProxy',
      appid: 'qimei_qq_android',
      sign: headerSign,
      'User-Agent': 'QQMusic',
      timestamp: String(tsSec)
    },
    body: {
      app: 0,
      os: 1,
      qimeiParams: { key, params, time: String(tsSec), nonce, sign, extra }
    }
  }).catch(() => null)
  try {
    const inner = typeof json?.data === 'string' ? JSON.parse(json.data) : null
    const q16 = String(inner?.data?.q16 ?? '')
    const q36 = String(inner?.data?.q36 ?? '')
    return q36 ? { q16, q36 } : null
  } catch {
    return null
  }
}

let qimeiTask: Promise<void> | null = null

/** 确保 QIMEI 就绪：只联网一次，失败用固定值兜底并写回，之后不再重试 */
export function ensureQimeiReady(): Promise<void> {
  const dev = getQQDevice()
  if (dev.qimei?.q36) return Promise.resolve()
  if (qimeiTask) return qimeiTask
  qimeiTask = (async () => {
    const result = await fetchQimei(dev)
    dev.qimei = result ?? { q16: '', q36: DEFAULT_Q36 }
    saveDevice(dev)
  })().finally(() => {
    qimeiTask = null
  })
  return qimeiTask
}
