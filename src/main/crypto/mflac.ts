/**
 * QQ 音乐 mflac/mgg 加密流解密（QMC2，1:1 移植自 cpp/MflacCrypto/MflacCrypto.cpp）。
 *
 * 流程：ekey → base64/TEA 解出真实 key → 按 key 长度选 map(≤300) 或 RC4 流密码 →
 *   decrypt(chunk, fileOffset) 按字节偏移解密（天然支持 Range/seek）。
 */

// —— 常量（与 C++ 逐字一致）——
const V1_KEY_SIZE = 128
const V1_OFFSET_BOUNDARY = 0x7fff
const FIRST_SEGMENT_SIZE = 0x0080
const OTHER_SEGMENT_SIZE = 0x1400
const RC4_STREAM_CACHE_SIZE = OTHER_SEGMENT_SIZE + 512

const EKEY_V2_PREFIX = Buffer.from('UVFNdXNpYyBFbmNWMixLZXk6', 'latin1') // 24B
const EKEY_V2_KEY1 = Uint8Array.from([
  0x33, 0x38, 0x36, 0x5a, 0x4a, 0x59, 0x21, 0x40, 0x23, 0x2a, 0x24, 0x25, 0x5e, 0x26, 0x29, 0x28
])
const EKEY_V2_KEY2 = Uint8Array.from([
  0x2a, 0x2a, 0x23, 0x21, 0x28, 0x23, 0x24, 0x25, 0x26, 0x5e, 0x61, 0x31, 0x63, 0x5a, 0x2c, 0x54
])
const EKEY_SIMPLE_KEY = Uint8Array.from([105, 86, 70, 56, 43, 32, 21, 11])

// —— TEA（8 字节块，16 轮，CBC 双 IV，对应 tea_decrypt_block/tea_decrypt）——
const DELTA = 0x9e3779b9

function b2i(p: Uint8Array, o: number): number {
  return ((p[o] << 24) | (p[o + 1] << 16) | (p[o + 2] << 8) | p[o + 3]) >>> 0
}
function i2b(v: number, p: Uint8Array, o: number): void {
  p[o] = (v >>> 24) & 0xff
  p[o + 1] = (v >>> 16) & 0xff
  p[o + 2] = (v >>> 8) & 0xff
  p[o + 3] = v & 0xff
}

function teaDecryptBlock(block: Uint8Array, off: number, k: number[]): void {
  let y = b2i(block, off)
  let z = b2i(block, off + 4)
  let sum = (DELTA * 16) >>> 0
  for (let r = 0; r < 16; r++) {
    z = (z - ((((y << 4) + k[2]) ^ (y + sum) ^ ((y >>> 5) + k[3])) >>> 0)) >>> 0
    y = (y - ((((z << 4) + k[0]) ^ (z + sum) ^ ((z >>> 5) + k[1])) >>> 0)) >>> 0
    sum = (sum - DELTA) >>> 0
  }
  i2b(y, block, off)
  i2b(z, block, off + 4)
}

/** 对应 tea_decrypt：CBC 双 IV 解密 + 去头尾填充，返回 payload 或 null */
function teaDecrypt(cipher: Uint8Array, key16: Uint8Array): Uint8Array | null {
  const len = cipher.length
  if (len < 16 || len % 8 !== 0) return null
  const k = [b2i(key16, 0), b2i(key16, 4), b2i(key16, 8), b2i(key16, 12)]
  const dec = Uint8Array.from(cipher)

  const iv1 = new Uint8Array(8)
  const iv2 = new Uint8Array(8)
  const nextIv1 = new Uint8Array(8)
  for (let i = 0; i < len; i += 8) {
    nextIv1.set(dec.subarray(i, i + 8))
    for (let x = 0; x < 8; x++) dec[i + x] ^= iv2[x]
    teaDecryptBlock(dec, i, k)
    iv2.set(dec.subarray(i, i + 8))
    for (let x = 0; x < 8; x++) dec[i + x] ^= iv1[x]
    iv1.set(nextIv1)
  }

  const pad = dec[0] & 7
  const hdr = 3 + pad
  const tail = 7
  if (hdr + tail > len) return null
  return dec.subarray(hdr, len - tail)
}

// —— EKEY 解密（V1/V2）——
function ekeyDecryptV1(ekey: Uint8Array): Uint8Array | null {
  if (ekey.length < 12) return null
  const raw = Buffer.from(Buffer.from(ekey).toString('latin1'), 'base64')
  if (raw.length < 12) return null

  const teaKey = new Uint8Array(16)
  for (let i = 0; i < 8; i++) {
    teaKey[i * 2] = EKEY_SIMPLE_KEY[i]
    teaKey[i * 2 + 1] = raw[i]
  }
  const payload = teaDecrypt(raw.subarray(8), teaKey)
  if (!payload) return null

  const out = new Uint8Array(8 + payload.length)
  out.set(raw.subarray(0, 8), 0)
  out.set(payload, 8)
  return out
}

function ekeyDecryptV2(ekey: Uint8Array): Uint8Array | null {
  const raw = Buffer.from(Buffer.from(ekey).toString('latin1'), 'base64')
  const dec1 = teaDecrypt(raw, EKEY_V2_KEY1)
  if (!dec1) return null
  const dec2 = teaDecrypt(dec1, EKEY_V2_KEY2)
  if (!dec2) return null
  // 到第一个 0 截断（C++ while dec2[v1Len]!=0）
  let v1Len = 0
  while (v1Len < dec2.length && dec2[v1Len] !== 0) v1Len++
  return ekeyDecryptV1(dec2.subarray(0, v1Len))
}

function ekeyDecrypt(ekey: Uint8Array): Uint8Array | null {
  if (
    ekey.length > EKEY_V2_PREFIX.length &&
    Buffer.from(ekey.subarray(0, EKEY_V2_PREFIX.length)).equals(EKEY_V2_PREFIX)
  ) {
    return ekeyDecryptV2(ekey.subarray(EKEY_V2_PREFIX.length))
  }
  return ekeyDecryptV1(ekey)
}

// —— map 流密码（key ≤ 300）——
function keyCompress(src: Uint8Array): Uint8Array {
  const dst = new Uint8Array(V1_KEY_SIZE)
  const n = src.length
  for (let i = 0; i < V1_KEY_SIZE; i++) {
    const idx = (i * i + 71214) % n
    const b = src[idx]
    const shift = (idx + 4) % 8
    dst[i] = ((b << shift) | (b >>> shift)) & 0xff
  }
  return dst
}

function qmc1Transform(key: Uint8Array, value: number, offset: number): number {
  let off = offset
  if (off > V1_OFFSET_BOUNDARY) off = off % V1_OFFSET_BOUNDARY
  return value ^ key[off % V1_KEY_SIZE]
}

// —— RC4 流密码（key > 300）——
function rc4Hash(key: Uint8Array): number {
  let h = 1
  for (let i = 0; i < key.length; i++) {
    if (key[i] === 0) continue
    // C++ 是 uint32 乘法（溢出回绕），JS 需 Math.imul + 无符号化
    const next = Math.imul(h, key[i]) >>> 0
    if (next === 0 || next <= h) break
    h = next
  }
  return h
}

function rc4SegmentKey(id: number, seed: number, hash: number): number {
  if (seed === 0) return 0
  return Math.floor((hash / ((id + 1) * seed)) * 100.0)
}

function rc4InitStream(key: Uint8Array, outLen: number): Uint8Array {
  const n = key.length
  const s = new Uint8Array(n)
  for (let i = 0; i < n; i++) s[i] = i & 0xff
  let j = 0
  for (let i = 0; i < n; i++) {
    j = (j + s[i] + key[i % n]) % n
    const t = s[i]
    s[i] = s[j]
    s[j] = t
  }
  const out = new Uint8Array(outLen)
  let si = 0
  let sj = 0
  for (let k = 0; k < outLen; k++) {
    si = (si + 1) % n
    sj = (sj + s[si]) % n
    const t = s[si]
    s[si] = s[sj]
    s[sj] = t
    out[k] = s[(s[si] + s[sj]) % n]
  }
  return out
}

export interface AudioDecryptor {
  /** 就地或返回解密后的字节；fileOffset 为该 chunk 首字节在整文件中的偏移 */
  decrypt(chunk: Buffer, fileOffset: number): Buffer
}

class MapCipher implements AudioDecryptor {
  private readonly key: Uint8Array
  constructor(rawKey: Uint8Array) {
    this.key = keyCompress(rawKey)
  }
  decrypt(chunk: Buffer, fileOffset: number): Buffer {
    const out = Buffer.from(chunk)
    for (let i = 0; i < out.length; i++) out[i] = qmc1Transform(this.key, out[i], fileOffset + i)
    return out
  }
}

class Rc4Cipher implements AudioDecryptor {
  private readonly key: Uint8Array
  private readonly n: number
  private readonly hash: number
  private readonly keyStream: Uint8Array
  constructor(rawKey: Uint8Array) {
    this.key = rawKey
    this.n = rawKey.length
    this.hash = rc4Hash(rawKey)
    this.keyStream = rc4InitStream(rawKey, RC4_STREAM_CACHE_SIZE)
  }
  decrypt(chunk: Buffer, fileOffset: number): Buffer {
    const out = Buffer.from(chunk)
    const len = out.length
    const n = this.n
    let pos = 0
    let offset = fileOffset

    // 段一：前 0x80 字节，逐字节 segment key
    if (offset < FIRST_SEGMENT_SIZE) {
      const block = Math.min(len, FIRST_SEGMENT_SIZE - offset)
      for (let i = 0; i < block; i++) {
        const off = offset + i
        const seed = this.key[off % n]
        const idx = rc4SegmentKey(off, seed, this.hash) % n
        out[i] ^= this.key[idx]
      }
      pos = block
      offset += block
    }

    // 段二：对齐到 0x1400 边界的残块
    const excess = offset % OTHER_SEGMENT_SIZE
    if (pos < len && excess !== 0) {
      const block = Math.min(len - pos, OTHER_SEGMENT_SIZE - excess)
      const id = Math.floor(offset / OTHER_SEGMENT_SIZE)
      const seed = this.key[id % n]
      const skip = rc4SegmentKey(id, seed, this.hash) & 0x1ff
      for (let i = 0; i < block; i++) out[pos + i] ^= this.keyStream[skip + excess + i]
      pos += block
      offset += block
    }

    // 段三：整 0x1400 块循环
    while (pos < len) {
      const block = Math.min(len - pos, OTHER_SEGMENT_SIZE)
      const id = Math.floor(offset / OTHER_SEGMENT_SIZE)
      const seed = this.key[id % n]
      const skip = rc4SegmentKey(id, seed, this.hash) & 0x1ff
      for (let i = 0; i < block; i++) out[pos + i] ^= this.keyStream[skip + i]
      pos += block
      offset += block
    }
    return out
  }
}

/** 由 ekey 构造解密器；失败返回 null（调用方对 null 走透传）。 */
export function createMflacDecryptor(ekey: string): AudioDecryptor | null {
  if (!ekey || ekey.length < 12) return null
  try {
    const key = ekeyDecrypt(Buffer.from(ekey, 'latin1'))
    if (!key || key.length === 0) return null
    // C++ create_cipher：keyLen<=300 → map，否则 RC4
    return key.length <= 300 ? new MapCipher(key) : new Rc4Cipher(key)
  } catch {
    return null
  }
}

/**
 * 整文件原地解密（对应 Android MflacCrypto.decryptFile，下载完成后用）。
 * 读入密文 → 从偏移 0 解密 → 写回同一路径。ekey 无效则抛错。
 */
export async function decryptFile(filePath: string, ekey: string): Promise<void> {
  const { readFile, writeFile } = await import('node:fs/promises')
  const decryptor = createMflacDecryptor(ekey)
  if (!decryptor) throw new Error('无效 ekey，无法构造解密器')
  const cipher = await readFile(filePath)
  const plain = decryptor.decrypt(cipher, 0)
  await writeFile(filePath, plain)
}
