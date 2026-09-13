/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 酷我 wbd 接口加解密（移植自 LX kw/util.js 的 wbdCrypto）。
 * 请求：JSON → AES-128-ECB → base64 作为 data；sign = MD5(appId + data + time) 大写。
 * 响应：（可能经 URL 编码的）base64，AES 解密后为 JSON 文本。
 */
import { createCipheriv, createDecipheriv, createHash } from 'node:crypto'

const AES_KEY = Buffer.from([
  112, 87, 39, 61, 199, 250, 41, 191, 57, 68, 45, 114, 221, 94, 140, 228
])
const APP_ID = 'y67sprxhhpws'

export function wbdBuildParam(data: unknown): string {
  const cipher = createCipheriv('aes-128-ecb', AES_KEY, null)
  const encoded = Buffer.concat([
    cipher.update(Buffer.from(JSON.stringify(data), 'utf-8')),
    cipher.final()
  ]).toString('base64')
  const time = Date.now()
  const sign = createHash('md5').update(`${APP_ID}${encoded}${time}`).digest('hex').toUpperCase()
  return `data=${encodeURIComponent(encoded)}&time=${time}&appId=${APP_ID}&sign=${sign}`
}

export function wbdDecode(text: string): any {
  let b64 = text.trim()
  try {
    b64 = decodeURIComponent(b64)
  } catch {
    /* 未经 URL 编码，原样使用 */
  }
  const decipher = createDecipheriv('aes-128-ecb', AES_KEY, null)
  const plain = Buffer.concat([decipher.update(Buffer.from(b64, 'base64')), decipher.final()])
  return JSON.parse(plain.toString('utf-8'))
}
