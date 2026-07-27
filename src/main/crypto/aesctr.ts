/**
 * Spotify CDN 加密流解密：AES-128-CTR，IV 固定，密钥为后端 /music/url 返回的 ekey（32 位 hex = 16 字节）。
 *
 * CTR 是计数器模式流密码：计数器块 = IV + floor(offset/16)（128 位大端自增），
 * 因此任意文件偏移都能就地重建密钥流——和 mflac 一样天然支持 Range/seek。
 * 连续读取（常态）复用同一个 decipher，仅在偏移跳变（seek/Range）时重建。
 */
import { createDecipheriv, type Decipher } from 'node:crypto'
import type { AudioDecryptor } from './mflac'

/** 固定 IV（对应 Android 端 audioAESIV） */
const SPOTIFY_IV = Buffer.from([
  0x72, 0xe0, 0x67, 0xfb, 0xdd, 0xcb, 0xcf, 0x77, 0xeb, 0xe8, 0xbc, 0x64, 0x3f, 0x63, 0x0d, 0x93
])
const BLOCK = 16
const IV_BIGINT = BigInt(`0x${SPOTIFY_IV.toString('hex')}`)
const UINT128_MASK = (1n << 128n) - 1n

class AesCtrDecryptor implements AudioDecryptor {
  private decipher: Decipher | null = null
  private nextOffset = 0

  constructor(private readonly key: Buffer) {}

  decrypt(chunk: Buffer, fileOffset: number): Buffer {
    if (!this.decipher || fileOffset !== this.nextOffset) this.seek(fileOffset)
    const out = this.decipher!.update(chunk) as Buffer
    this.nextOffset = fileOffset + chunk.length
    return out
  }

  /** 把密钥流定位到 offset：IV 加上块号作初始计数器，再丢弃块内残余字节 */
  private seek(offset: number): void {
    const block = Math.floor(offset / BLOCK)
    const skip = offset % BLOCK
    const counter = (IV_BIGINT + BigInt(block)) & UINT128_MASK
    const iv = Buffer.from(counter.toString(16).padStart(32, '0'), 'hex')
    this.decipher = createDecipheriv('aes-128-ctr', this.key, iv)
    if (skip > 0) this.decipher.update(Buffer.alloc(skip))
  }
}

/**
 * Spotify 在真实音频前故意塞了一个伪造的 Ogg 页（内容即 heads-fa.cdn /head/{fileid} 返回的
 * 前 0xa7 字节），让 naive 播放器/下载器直接解析失败。真实流从解密后偏移 0xa7 的
 * OggS BOS 页开始（已用线上数据验证）。CTR 计数器从文件偏移 0 起算、连续覆盖头部，
 * 因此跳过方式 = 从文件偏移 0xa7 起取流/解密。
 */
export const SP_HEADER_SIZE = 0xa7

/** 由 ekey（32 位 hex）构造 AES-128-CTR 解密器；格式不符返回 null（调用方对 null 走透传）。 */
export function createAesCtrDecryptor(ekey: string): AudioDecryptor | null {
  if (!/^[0-9a-fA-F]{32}$/.test(ekey)) return null
  try {
    return new AesCtrDecryptor(Buffer.from(ekey, 'hex'))
  } catch {
    return null
  }
}

/** 整文件解密并剥掉 0xa7 伪造头（下载完成后原地写回真实音频）。ekey 无效则抛错。 */
export async function decryptFileAesCtr(filePath: string, ekey: string): Promise<void> {
  const { readFile, writeFile } = await import('node:fs/promises')
  const decryptor = createAesCtrDecryptor(ekey)
  if (!decryptor) throw new Error('无效 ekey，无法构造 AES-CTR 解密器')
  const cipher = await readFile(filePath)
  if (cipher.length <= SP_HEADER_SIZE) throw new Error('密文长度不足（小于 Spotify 文件头）')
  // 从 0xa7 起解密（计数器连续），写回时不含伪造头
  const plain = decryptor.decrypt(cipher.subarray(SP_HEADER_SIZE), SP_HEADER_SIZE)
  await writeFile(filePath, plain)
}
