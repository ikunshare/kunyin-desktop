/**
 * LX 同步加密/压缩工具（1:1 移植 Android sync/SyncCrypto.kt，与 Go 端 sync/crypto.go 对齐）。
 * 全部用 Node 内建 crypto/zlib。
 */
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  generateKeyPairSync,
  privateDecrypt,
  randomBytes,
  constants as cryptoConstants,
  type KeyObject
} from 'node:crypto'
import { gunzipSync, gzipSync } from 'node:zlib'
import { SyncProtocol } from './protocol'

/** 与 Go 端 deriveAESKey 一致：md5(password) hex 前 16 字节 → base64。 */
export function deriveAESKey(password: string): string {
  const md5hex = createHash('md5').update(password, 'utf-8').digest('hex')
  return Buffer.from(md5hex.substring(0, 16), 'ascii').toString('base64')
}

/** 16 字节随机 → base64。 */
export function generateAESKey(): string {
  return randomBytes(16).toString('base64')
}

/** AES-128 ECB + PKCS7，输出 base64。 */
export function aesEncrypt(plain: string, keyB64: string): string {
  const key = Buffer.from(keyB64, 'base64')
  const cipher = createCipheriv('aes-128-ecb', key, null)
  cipher.setAutoPadding(true)
  return Buffer.concat([cipher.update(plain, 'utf-8'), cipher.final()]).toString('base64')
}

export function aesDecrypt(cipherB64: string, keyB64: string): string {
  const key = Buffer.from(keyB64, 'base64')
  const data = Buffer.from(cipherB64, 'base64')
  const decipher = createDecipheriv('aes-128-ecb', key, null)
  decipher.setAutoPadding(true)
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf-8')
}

/** RSA-OAEP-SHA1 解密（服务端用客户端公钥加密，客户端私钥解密）。 */
export function rsaDecrypt(cipherB64: string, privateKey: KeyObject): Buffer {
  const data = Buffer.from(cipherB64, 'base64')
  return privateDecrypt(
    {
      key: privateKey,
      padding: cryptoConstants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha1'
    },
    data
  )
}

export interface SyncKeyPair {
  privateKey: KeyObject
  /** SPKI DER 的 base64（对应 Android kp.public.encoded → base64 NO_WRAP） */
  publicKeyPem: string
}

/** 生成 2048 位 RSA keypair，publicKey 以 SPKI DER base64 表示（与 Kotlin X509EncodedKeySpec 一致）。 */
export function generateRsa(): SyncKeyPair {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const spkiDer = publicKey.export({ type: 'spki', format: 'der' })
  return {
    privateKey,
    publicKeyPem: Buffer.from(spkiDer).toString('base64')
  }
}

/** > 1024 字节时 gzip+base64，加 `cg_` 前缀（按字节计长度）。 */
export function compressMsg(msg: string): string {
  const bytes = Buffer.from(msg, 'utf-8')
  if (bytes.length <= SyncProtocol.COMPRESS_THRESH) return msg
  return SyncProtocol.COMPRESS_PREFIX + gzipSync(bytes).toString('base64')
}

export function decompressMsg(msg: string): string {
  if (!msg.startsWith(SyncProtocol.COMPRESS_PREFIX)) return msg
  const payload = msg.substring(SyncProtocol.COMPRESS_PREFIX.length)
  return gunzipSync(Buffer.from(payload, 'base64')).toString('utf-8')
}

/** 直接对二进制 gzip 数据解压（服务端发的原始 gzip 二进制帧）。 */
export function decompressGzipBytes(data: Buffer): string {
  return gunzipSync(data).toString('utf-8')
}

/** 检测 gzip magic bytes 0x1f 0x8b。 */
export function isGzipBytes(data: Buffer): boolean {
  return data.length >= 2 && data[0] === 0x1f && data[1] === 0x8b
}

/** ListData 的 md5 hex（用于回环去重）。 */
export function md5OfListData(json: unknown): string {
  return createHash('md5').update(JSON.stringify(json), 'utf-8').digest('hex')
}
