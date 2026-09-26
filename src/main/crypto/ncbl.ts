/**
 * 网易云客户端埋点日志的封包格式 NCBL（逐字移植自 folltoshe/netease-report-listen-song 的
 * src/common/crypto，出处 https://github.com/folltoshe/netease-report-listen-song）。
 *
 * 结构（小端）：
 *   0  "NCBL"        magic
 *   4  u32           版本，固定 3
 *   8  u16           头部总长 = 70 + 元信息块长度
 *   10 16B           uuid（ChaCha20 的 nonce 与计数器都从它派生）
 *   26 32B           KEY_B = KEY_A^e mod N（裸 RSA 包裹的记录密钥）
 *   58 u32           首条记录序号
 *   62 u32           末条记录序号
 *   66 u32           记录区总长
 *   70 [u16 type][u16 len][data]…   元信息块（type=0x4343，用 KEY_B 加密）
 *      [u16 len][u32 seq][data]…    记录区（用 KEY_A 加密，各片拼起来是一条 zstd 流）
 *
 * 两处易踩的点，改动时务必保持：
 * - nonce 取 uuid 前 12 字节，计数器是第 12..15 字节的 u32 **右移 2 位**，不是直接当计数器用。
 * - KEY_A 必须小于 RSA 模数 N（裸 RSA 无填充），所以首字节夹到 ≤ 0xA2；漏掉这一步会偶发
 *   （首字节 ≥ 0xA3，约 1/4 概率）算出一个 mod N 之后对不上的 KEY_B，服务端整包丢弃且不报错。
 *
 * 这里不 import electron，保证能被 node --test 直接跑（tools/ncbl.test.mjs 做往返比对）。
 */
import { randomBytes } from 'node:crypto'
import { zstdCompressSync, zstdDecompressSync } from 'node:zlib'

const MAGIC = Buffer.from('NCBL', 'ascii')
const VERSION = 3
const HEADER_FIXED_LEN = 70
const META_BLOCK_TYPE = 0x4343
/** 每帧负载上限，受帧头 u16 长度字段约束 */
const DEFAULT_MAX_FRAME = 0x8000

/** 公开模数 N（256 位，取自 libbilog.so） */
const RSA_N = 0xfd90bd466ff9bc8a3fec2fbcf263b90d5c564879fa5d7aab89b31c1d5cb4139dn
const RSA_E = 65537n
/** N 的两个因子（FactorDB 分解得到），只用于把 KEY_A 还原出来做自检 */
const RSA_P = 337838269511367116547262517807543394287n
const RSA_Q = 339484579896250424463517790785600633139n

const FIELD_SEP = '\x01'

export interface LogRecord {
  /** 事件时刻（秒） */
  time: number
  /** 动作名，如 _plv / _pld */
  action: string
  data: string | object
}

export interface NcblParts {
  /** 设备/登录态元信息块明文（调用方构造的 JSON） */
  meta: Buffer | string
  /** 日志记录区明文（buildRecords 的结果） */
  body: Buffer | string
}

export interface EncryptOptions {
  /** 32 字节记录密钥；默认随机（首字节夹到 ≤ 0xA2） */
  keyA?: Buffer
  /** 16 字节 uuid，派生 nonce/计数器；默认随机 UUIDv4 形状 */
  uuid?: Buffer
  /** 首条记录序号；默认随机 */
  baseSeq?: number
  /** 每帧压缩后字节上限；默认 0x8000 */
  maxFrame?: number
}

export interface DecryptResult {
  meta: Buffer
  body: Buffer
  extra: {
    version: number
    headerLen: number
    uuid: Buffer
    nonce: Buffer
    counter: number
    keyB: Buffer
    keyA: Buffer
    firstSeq: number
    lastSeq: number
  }
}

// —— ChaCha20（无 Poly1305，纯 keystream 异或）——
const SIGMA = [0x61707865, 0x3320646e, 0x79622d32, 0x6b206574]

function rotl(x: number, n: number): number {
  return ((x << n) | (x >>> (32 - n))) >>> 0
}

function quarterRound(s: Uint32Array, a: number, b: number, c: number, d: number): void {
  s[a] = (s[a] + s[b]) >>> 0
  s[d] ^= s[a]
  s[d] = rotl(s[d], 16)
  s[c] = (s[c] + s[d]) >>> 0
  s[b] ^= s[c]
  s[b] = rotl(s[b], 12)
  s[a] = (s[a] + s[b]) >>> 0
  s[d] ^= s[a]
  s[d] = rotl(s[d], 8)
  s[c] = (s[c] + s[d]) >>> 0
  s[b] ^= s[c]
  s[b] = rotl(s[b], 7)
}

function chachaBlock(key: Buffer, counter: number, nonce: Buffer): Buffer {
  const state = new Uint32Array(16)
  state[0] = SIGMA[0]
  state[1] = SIGMA[1]
  state[2] = SIGMA[2]
  state[3] = SIGMA[3]
  for (let i = 0; i < 8; i++) state[4 + i] = key.readUInt32LE(i * 4)
  state[12] = counter >>> 0
  state[13] = nonce.readUInt32LE(0)
  state[14] = nonce.readUInt32LE(4)
  state[15] = nonce.readUInt32LE(8)

  const work = state.slice()
  for (let i = 0; i < 10; i++) {
    quarterRound(work, 0, 4, 8, 12)
    quarterRound(work, 1, 5, 9, 13)
    quarterRound(work, 2, 6, 10, 14)
    quarterRound(work, 3, 7, 11, 15)
    quarterRound(work, 0, 5, 10, 15)
    quarterRound(work, 1, 6, 11, 12)
    quarterRound(work, 2, 7, 8, 13)
    quarterRound(work, 3, 4, 9, 14)
  }

  const out = Buffer.allocUnsafe(64)
  for (let i = 0; i < 16; i++) out.writeUInt32LE((work[i] + state[i]) >>> 0, i * 4)
  return out
}

export function chacha20(key: Buffer, counter: number, nonce: Buffer, data: Buffer): Buffer {
  const out = Buffer.allocUnsafe(data.length)
  for (let off = 0; off < data.length; off += 64) {
    const ks = chachaBlock(key, (counter + (off >>> 6)) >>> 0, nonce)
    const end = Math.min(off + 64, data.length)
    for (let i = off; i < end; i++) out[i] = data[i] ^ ks[i - off]
  }
  return out
}

// —— 裸 RSA（无填充，大端）——
function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n
  base %= mod
  while (exp > 0n) {
    if (exp & 1n) result = (result * base) % mod
    base = (base * base) % mod
    exp >>= 1n
  }
  return result
}

function modInverse(a: bigint, m: bigint): bigint {
  let [oldR, r] = [a % m, m]
  let [oldS, s] = [1n, 0n]
  while (r !== 0n) {
    const q = oldR / r
    const nextR = oldR - q * r
    const nextS = oldS - q * s
    oldR = r
    r = nextR
    oldS = s
    s = nextS
  }
  return ((oldS % m) + m) % m
}

function beToBig(buf: Buffer): bigint {
  let n = 0n
  for (const b of buf) n = (n << 8n) | BigInt(b)
  return n
}

function bigToBe(n: bigint, len: number): Buffer {
  const out = Buffer.alloc(len)
  for (let i = len - 1; i >= 0; i--) {
    out[i] = Number(n & 0xffn)
    n >>= 8n
  }
  return out
}

let rsaD: bigint | null = null

/** KEY_B = KEY_A^e mod N。KEY_A 必须 < N（调用方已把首字节夹到 ≤ 0xA2）。 */
export function rsaWrap(keyA: Buffer): Buffer {
  return bigToBe(modPow(beToBig(keyA), RSA_E, RSA_N), 32)
}

/** 从 KEY_B 还原 KEY_A（仅自检/排查用） */
export function rsaUnWrap(keyB: Buffer): Buffer {
  rsaD ??= modInverse(RSA_E, (RSA_P - 1n) * (RSA_Q - 1n))
  return bigToBe(modPow(beToBig(keyB), rsaD, RSA_N), 32)
}

// —— 记录区 ——
/** 一条记录：`<时刻>\x01<动作>\x01<JSON>` */
export function buildRecord({ time, action, data }: LogRecord): string {
  const json = typeof data === 'string' ? data : JSON.stringify(data)
  return [time, action, json].join(FIELD_SEP)
}

/**
 * 多条记录首尾直接相接（上游如此，中间没有任何分隔符）。
 * 正因为没有分隔符，上报侧一次只封一条记录、每条独立上传，别把多条攒在一起。
 */
export function buildRecords(records: LogRecord[]): string {
  return records.map(buildRecord).join('')
}

/** 把元信息与记录区封成 NCBL 字节流 */
export function encryptNcbl(parts: NcblParts, options: EncryptOptions = {}): Buffer {
  const meta = Buffer.isBuffer(parts.meta) ? parts.meta : Buffer.from(parts.meta, 'utf-8')
  const body = Buffer.isBuffer(parts.body) ? parts.body : Buffer.from(parts.body, 'utf-8')
  const maxFrame = options.maxFrame ?? DEFAULT_MAX_FRAME

  const keyA = options.keyA ? Buffer.from(options.keyA) : randomBytes(32)
  // 裸 RSA 要求 KEY_A < N，N 的首字节是 0xFD，按上游夹到 0xA2
  if (keyA[0] >= 0xa3) keyA[0] = 0xa2

  const keyB = rsaWrap(keyA)

  const uuid = options.uuid ? Buffer.from(options.uuid) : randomBytes(16)
  if (!options.uuid) {
    uuid[6] = (uuid[6] & 0x0f) | 0x40 // version 4
    uuid[8] = (uuid[8] & 0x3f) | 0x80 // variant
  }
  const nonce = uuid.subarray(0, 12)
  const counter = uuid.readUInt32LE(12) >>> 2
  const baseSeq = options.baseSeq ?? randomBytes(2).readUInt16LE(0)

  // 元信息块（type 0x4343），用 KEY_B 加密
  const metaCipher = chacha20(keyB, counter, nonce, meta)
  const metaHead = Buffer.allocUnsafe(4)
  metaHead.writeUInt16LE(META_BLOCK_TYPE, 0)
  metaHead.writeUInt16LE(metaCipher.length, 2)
  const metaBlock = Buffer.concat([metaHead, metaCipher])
  const headerLen = HEADER_FIXED_LEN + metaBlock.length

  // 记录区：整条 zstd 流切成 ≤ maxFrame 的片，每片用 KEY_A 加密
  const compressed = zstdCompressSync(body)
  const frames: Buffer[] = []
  let seq = baseSeq
  for (let off = 0; off < compressed.length || off === 0; off += maxFrame) {
    const slice = compressed.subarray(off, off + maxFrame)
    const cipher = chacha20(keyA, counter, nonce, slice)
    const head = Buffer.allocUnsafe(6)
    head.writeUInt16LE(cipher.length, 0)
    head.writeUInt32LE(seq >>> 0, 2)
    frames.push(head, cipher)
    seq++
    if (compressed.length === 0) break
  }

  const trailing = Buffer.concat(frames)
  const frameCount = seq - baseSeq

  const header = Buffer.alloc(HEADER_FIXED_LEN)
  MAGIC.copy(header, 0)
  header.writeUInt32LE(VERSION, 4)
  header.writeUInt16LE(headerLen, 8)
  uuid.copy(header, 10)
  keyB.copy(header, 26)
  header.writeUInt32LE(baseSeq >>> 0, 58)
  header.writeUInt32LE((baseSeq + frameCount - 1) >>> 0, 62)
  header.writeUInt32LE(trailing.length, 66)

  return Buffer.concat([header, metaBlock, trailing])
}

/** 解回元信息与记录区（自检/排查用，上报链路不走它） */
export function decryptNcbl(payload: Buffer): DecryptResult {
  if (!payload.subarray(0, 4).equals(MAGIC)) throw new Error('not an NCBL payload')

  const version = payload.readUInt32LE(4)
  const headerLen = payload.readUInt16LE(8)
  const uuid = payload.subarray(10, 26)
  const keyB = payload.subarray(26, 58)
  const firstSeq = payload.readUInt32LE(58)
  const lastSeq = payload.readUInt32LE(62)

  const keyA = rsaUnWrap(keyB)
  const nonce = uuid.subarray(0, 12)
  const counter = uuid.readUInt32LE(12) >>> 2

  const metaChunks: Buffer[] = []
  let pos = HEADER_FIXED_LEN
  while (pos + 4 <= headerLen) {
    const type = payload.readUInt16LE(pos)
    const len = payload.readUInt16LE(pos + 2)
    const data = payload.subarray(pos + 4, pos + 4 + len)
    if (type === META_BLOCK_TYPE) metaChunks.push(chacha20(keyB, counter, nonce, data))
    pos += 4 + len
  }

  const trailing = payload.subarray(headerLen)
  const recordChunks: Buffer[] = []
  pos = 0
  while (pos + 6 <= trailing.length) {
    const len = trailing.readUInt16LE(pos)
    const data = trailing.subarray(pos + 6, pos + 6 + len)
    recordChunks.push(chacha20(keyA, counter, nonce, data))
    pos += 6 + len
  }

  const compressed = Buffer.concat(recordChunks)
  const body = compressed.length ? zstdDecompressSync(compressed) : Buffer.alloc(0)

  return {
    meta: Buffer.concat(metaChunks),
    body,
    extra: {
      version,
      headerLen,
      uuid: Buffer.from(uuid),
      nonce: Buffer.from(nonce),
      counter,
      keyB: Buffer.from(keyB),
      keyA,
      firstSeq,
      lastSeq
    }
  }
}
