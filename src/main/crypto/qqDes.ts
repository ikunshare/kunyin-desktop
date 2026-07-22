/**
 * QQ / JOOX QRC 专用三重 DES（1:1 移植自 app/src/main/cpp/Lrc/Lrc.cpp）。
 *
 * 注意：这是**改版 DES**（S-box、置换表均为自定义，标准 OpenSSL des-ede3 无法匹配，
 * 实测解出的字节不是合法 zlib）。故必须逐位复刻 C++ 实现。
 * 密钥固定 `!@#)(*$%123ZXC!@!@#)(NHL`（24B），ECB、不足 8 字节的尾块保持原样。
 */

// prettier-ignore
const SBOX: number[][] = [
  [14, 4, 13, 1, 2, 15, 11, 8, 3, 10, 6, 12, 5, 9, 0, 7, 0, 15, 7, 4, 14, 2, 13, 1, 10, 6, 12, 11, 9, 5, 3, 8, 4, 1, 14, 8, 13, 6, 2, 11, 15, 12, 9, 7, 3, 10, 5, 0, 15, 12, 8, 2, 4, 9, 1, 7, 5, 11, 3, 14, 10, 0, 6, 13],
  [15, 1, 8, 14, 6, 11, 3, 4, 9, 7, 2, 13, 12, 0, 5, 10, 3, 13, 4, 7, 15, 2, 8, 15, 12, 0, 1, 10, 6, 9, 11, 5, 0, 14, 7, 11, 10, 4, 13, 1, 5, 8, 12, 6, 9, 3, 2, 15, 13, 8, 10, 1, 3, 15, 4, 2, 11, 6, 7, 12, 0, 5, 14, 9],
  [10, 0, 9, 14, 6, 3, 15, 5, 1, 13, 12, 7, 11, 4, 2, 8, 13, 7, 0, 9, 3, 4, 6, 10, 2, 8, 5, 14, 12, 11, 15, 1, 13, 6, 4, 9, 8, 15, 3, 0, 11, 1, 2, 12, 5, 10, 14, 7, 1, 10, 13, 0, 6, 9, 8, 7, 4, 15, 14, 3, 11, 5, 2, 12],
  [7, 13, 14, 3, 0, 6, 9, 10, 1, 2, 8, 5, 11, 12, 4, 15, 13, 8, 11, 5, 6, 15, 0, 3, 4, 7, 2, 12, 1, 10, 14, 9, 10, 6, 9, 0, 12, 11, 7, 13, 15, 1, 3, 14, 5, 2, 8, 4, 3, 15, 0, 6, 10, 10, 13, 8, 9, 4, 5, 11, 12, 7, 2, 14],
  [2, 12, 4, 1, 7, 10, 11, 6, 8, 5, 3, 15, 13, 0, 14, 9, 14, 11, 2, 12, 4, 7, 13, 1, 5, 0, 15, 10, 3, 9, 8, 6, 4, 2, 1, 11, 10, 13, 7, 8, 15, 9, 12, 5, 6, 3, 0, 14, 11, 8, 12, 7, 1, 14, 2, 13, 6, 15, 0, 9, 10, 4, 5, 3],
  [12, 1, 10, 15, 9, 2, 6, 8, 0, 13, 3, 4, 14, 7, 5, 11, 10, 15, 4, 2, 7, 12, 9, 5, 6, 1, 13, 14, 0, 11, 3, 8, 9, 14, 15, 5, 2, 8, 12, 3, 7, 0, 4, 10, 1, 13, 11, 6, 4, 3, 2, 12, 9, 5, 15, 10, 11, 14, 1, 7, 6, 0, 8, 13],
  [4, 11, 2, 14, 15, 0, 8, 13, 3, 12, 9, 7, 5, 10, 6, 1, 13, 0, 11, 7, 4, 9, 1, 10, 14, 3, 5, 12, 2, 15, 8, 6, 1, 4, 11, 13, 12, 3, 7, 14, 10, 15, 6, 8, 0, 5, 9, 2, 6, 11, 13, 8, 1, 4, 10, 7, 9, 5, 0, 15, 14, 2, 3, 12],
  [13, 2, 8, 4, 6, 15, 11, 1, 10, 9, 3, 14, 5, 0, 12, 7, 1, 15, 13, 8, 10, 3, 7, 4, 12, 5, 6, 11, 0, 14, 9, 2, 7, 11, 4, 1, 9, 12, 14, 2, 0, 6, 10, 13, 15, 3, 5, 8, 2, 1, 14, 7, 4, 10, 8, 13, 15, 12, 9, 0, 3, 5, 6, 11]
]

const KEY_RND_SHIFT = [1, 1, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 1]
// prettier-ignore
const KEY_PERM_C = [56, 48, 40, 32, 24, 16, 8, 0, 57, 49, 41, 33, 25, 17, 9, 1, 58, 50, 42, 34, 26, 18, 10, 2, 59, 51, 43, 35]
// prettier-ignore
const KEY_PERM_D = [62, 54, 46, 38, 30, 22, 14, 6, 61, 53, 45, 37, 29, 21, 13, 5, 60, 52, 44, 36, 28, 20, 12, 4, 27, 19, 11, 3]
// prettier-ignore
const KEY_COMPRESSION = [13, 16, 10, 23, 0, 4, 2, 27, 14, 5, 20, 9, 22, 18, 11, 3, 25, 7, 15, 6, 26, 19, 12, 1, 40, 51, 30, 36, 46, 54, 29, 39, 50, 44, 32, 47, 43, 48, 38, 55, 33, 52, 45, 41, 49, 35, 28, 31]

const DES_ENCRYPT = 1
const DES_DECRYPT = 0

function bitnum(a: Uint8Array, b: number, c: number): number {
  return (((a[((b / 32) | 0) * 4 + 3 - (((b % 32) / 8) | 0)] >> (7 - (b % 8))) & 1) << c) >>> 0
}
function bitnumIntr(a: number, b: number, c: number): number {
  return (((a >>> (31 - b)) & 1) << c) >>> 0
}
function bitnumIntl(a: number, b: number, c: number): number {
  return (((a << b) & 0x80000000) >>> c) >>> 0
}
function sboxBit(a: number): number {
  return (a & 32) | ((a & 31) >> 1) | ((a & 1) << 4)
}

function initialPermutation(input: Uint8Array): [number, number] {
  const s0 =
    (bitnum(input, 57, 31) |
      bitnum(input, 49, 30) |
      bitnum(input, 41, 29) |
      bitnum(input, 33, 28) |
      bitnum(input, 25, 27) |
      bitnum(input, 17, 26) |
      bitnum(input, 9, 25) |
      bitnum(input, 1, 24) |
      bitnum(input, 59, 23) |
      bitnum(input, 51, 22) |
      bitnum(input, 43, 21) |
      bitnum(input, 35, 20) |
      bitnum(input, 27, 19) |
      bitnum(input, 19, 18) |
      bitnum(input, 11, 17) |
      bitnum(input, 3, 16) |
      bitnum(input, 61, 15) |
      bitnum(input, 53, 14) |
      bitnum(input, 45, 13) |
      bitnum(input, 37, 12) |
      bitnum(input, 29, 11) |
      bitnum(input, 21, 10) |
      bitnum(input, 13, 9) |
      bitnum(input, 5, 8) |
      bitnum(input, 63, 7) |
      bitnum(input, 55, 6) |
      bitnum(input, 47, 5) |
      bitnum(input, 39, 4) |
      bitnum(input, 31, 3) |
      bitnum(input, 23, 2) |
      bitnum(input, 15, 1) |
      bitnum(input, 7, 0)) >>>
    0
  const s1 =
    (bitnum(input, 56, 31) |
      bitnum(input, 48, 30) |
      bitnum(input, 40, 29) |
      bitnum(input, 32, 28) |
      bitnum(input, 24, 27) |
      bitnum(input, 16, 26) |
      bitnum(input, 8, 25) |
      bitnum(input, 0, 24) |
      bitnum(input, 58, 23) |
      bitnum(input, 50, 22) |
      bitnum(input, 42, 21) |
      bitnum(input, 34, 20) |
      bitnum(input, 26, 19) |
      bitnum(input, 18, 18) |
      bitnum(input, 10, 17) |
      bitnum(input, 2, 16) |
      bitnum(input, 60, 15) |
      bitnum(input, 52, 14) |
      bitnum(input, 44, 13) |
      bitnum(input, 36, 12) |
      bitnum(input, 28, 11) |
      bitnum(input, 20, 10) |
      bitnum(input, 12, 9) |
      bitnum(input, 4, 8) |
      bitnum(input, 62, 7) |
      bitnum(input, 54, 6) |
      bitnum(input, 46, 5) |
      bitnum(input, 38, 4) |
      bitnum(input, 30, 3) |
      bitnum(input, 22, 2) |
      bitnum(input, 14, 1) |
      bitnum(input, 6, 0)) >>>
    0
  return [s0, s1]
}

function inversePermutation(s0: number, s1: number, out: Uint8Array): void {
  out[3] =
    (bitnumIntr(s1, 7, 7) |
      bitnumIntr(s0, 7, 6) |
      bitnumIntr(s1, 15, 5) |
      bitnumIntr(s0, 15, 4) |
      bitnumIntr(s1, 23, 3) |
      bitnumIntr(s0, 23, 2) |
      bitnumIntr(s1, 31, 1) |
      bitnumIntr(s0, 31, 0)) &
    0xff
  out[2] =
    (bitnumIntr(s1, 6, 7) |
      bitnumIntr(s0, 6, 6) |
      bitnumIntr(s1, 14, 5) |
      bitnumIntr(s0, 14, 4) |
      bitnumIntr(s1, 22, 3) |
      bitnumIntr(s0, 22, 2) |
      bitnumIntr(s1, 30, 1) |
      bitnumIntr(s0, 30, 0)) &
    0xff
  out[1] =
    (bitnumIntr(s1, 5, 7) |
      bitnumIntr(s0, 5, 6) |
      bitnumIntr(s1, 13, 5) |
      bitnumIntr(s0, 13, 4) |
      bitnumIntr(s1, 21, 3) |
      bitnumIntr(s0, 21, 2) |
      bitnumIntr(s1, 29, 1) |
      bitnumIntr(s0, 29, 0)) &
    0xff
  out[0] =
    (bitnumIntr(s1, 4, 7) |
      bitnumIntr(s0, 4, 6) |
      bitnumIntr(s1, 12, 5) |
      bitnumIntr(s0, 12, 4) |
      bitnumIntr(s1, 20, 3) |
      bitnumIntr(s0, 20, 2) |
      bitnumIntr(s1, 28, 1) |
      bitnumIntr(s0, 28, 0)) &
    0xff
  out[7] =
    (bitnumIntr(s1, 3, 7) |
      bitnumIntr(s0, 3, 6) |
      bitnumIntr(s1, 11, 5) |
      bitnumIntr(s0, 11, 4) |
      bitnumIntr(s1, 19, 3) |
      bitnumIntr(s0, 19, 2) |
      bitnumIntr(s1, 27, 1) |
      bitnumIntr(s0, 27, 0)) &
    0xff
  out[6] =
    (bitnumIntr(s1, 2, 7) |
      bitnumIntr(s0, 2, 6) |
      bitnumIntr(s1, 10, 5) |
      bitnumIntr(s0, 10, 4) |
      bitnumIntr(s1, 18, 3) |
      bitnumIntr(s0, 18, 2) |
      bitnumIntr(s1, 26, 1) |
      bitnumIntr(s0, 26, 0)) &
    0xff
  out[5] =
    (bitnumIntr(s1, 1, 7) |
      bitnumIntr(s0, 1, 6) |
      bitnumIntr(s1, 9, 5) |
      bitnumIntr(s0, 9, 4) |
      bitnumIntr(s1, 17, 3) |
      bitnumIntr(s0, 17, 2) |
      bitnumIntr(s1, 25, 1) |
      bitnumIntr(s0, 25, 0)) &
    0xff
  out[4] =
    (bitnumIntr(s1, 0, 7) |
      bitnumIntr(s0, 0, 6) |
      bitnumIntr(s1, 8, 5) |
      bitnumIntr(s0, 8, 4) |
      bitnumIntr(s1, 16, 3) |
      bitnumIntr(s0, 16, 2) |
      bitnumIntr(s1, 24, 1) |
      bitnumIntr(s0, 24, 0)) &
    0xff
}

function desF(state: number, key: Uint8Array): number {
  const t1 =
    (bitnumIntl(state, 31, 0) |
      ((state & 0xf0000000) >>> 1) |
      bitnumIntl(state, 4, 5) |
      bitnumIntl(state, 3, 6) |
      ((state & 0x0f000000) >>> 3) |
      bitnumIntl(state, 8, 11) |
      bitnumIntl(state, 7, 12) |
      ((state & 0x00f00000) >>> 5) |
      bitnumIntl(state, 12, 17) |
      bitnumIntl(state, 11, 18) |
      ((state & 0x000f0000) >>> 7) |
      bitnumIntl(state, 16, 23)) >>>
    0
  const t2 =
    (bitnumIntl(state, 15, 0) |
      ((state & 0x0000f000) << 15) |
      bitnumIntl(state, 20, 5) |
      bitnumIntl(state, 19, 6) |
      ((state & 0x00000f00) << 13) |
      bitnumIntl(state, 24, 11) |
      bitnumIntl(state, 23, 12) |
      ((state & 0x000000f0) << 11) |
      bitnumIntl(state, 28, 17) |
      bitnumIntl(state, 27, 18) |
      ((state & 0x0000000f) << 9) |
      bitnumIntl(state, 0, 23)) >>>
    0
  const lrgstate = [
    (t1 >>> 24) & 0xff,
    (t1 >>> 16) & 0xff,
    (t1 >>> 8) & 0xff,
    (t2 >>> 24) & 0xff,
    (t2 >>> 16) & 0xff,
    (t2 >>> 8) & 0xff
  ]
  for (let i = 0; i < 6; i++) lrgstate[i] ^= key[i]
  const s =
    ((SBOX[0][sboxBit(lrgstate[0] >> 2)] << 28) |
      (SBOX[1][sboxBit(((lrgstate[0] & 0x03) << 4) | (lrgstate[1] >> 4))] << 24) |
      (SBOX[2][sboxBit(((lrgstate[1] & 0x0f) << 2) | (lrgstate[2] >> 6))] << 20) |
      (SBOX[3][sboxBit(lrgstate[2] & 0x3f)] << 16) |
      (SBOX[4][sboxBit(lrgstate[3] >> 2)] << 12) |
      (SBOX[5][sboxBit(((lrgstate[3] & 0x03) << 4) | (lrgstate[4] >> 4))] << 8) |
      (SBOX[6][sboxBit(((lrgstate[4] & 0x0f) << 2) | (lrgstate[5] >> 6))] << 4) |
      SBOX[7][sboxBit(lrgstate[5] & 0x3f)]) >>>
    0
  return (
    (bitnumIntl(s, 15, 0) |
      bitnumIntl(s, 6, 1) |
      bitnumIntl(s, 19, 2) |
      bitnumIntl(s, 20, 3) |
      bitnumIntl(s, 28, 4) |
      bitnumIntl(s, 11, 5) |
      bitnumIntl(s, 27, 6) |
      bitnumIntl(s, 16, 7) |
      bitnumIntl(s, 0, 8) |
      bitnumIntl(s, 14, 9) |
      bitnumIntl(s, 22, 10) |
      bitnumIntl(s, 25, 11) |
      bitnumIntl(s, 4, 12) |
      bitnumIntl(s, 17, 13) |
      bitnumIntl(s, 30, 14) |
      bitnumIntl(s, 9, 15) |
      bitnumIntl(s, 1, 16) |
      bitnumIntl(s, 7, 17) |
      bitnumIntl(s, 23, 18) |
      bitnumIntl(s, 13, 19) |
      bitnumIntl(s, 31, 20) |
      bitnumIntl(s, 26, 21) |
      bitnumIntl(s, 2, 22) |
      bitnumIntl(s, 8, 23) |
      bitnumIntl(s, 18, 24) |
      bitnumIntl(s, 12, 25) |
      bitnumIntl(s, 29, 26) |
      bitnumIntl(s, 5, 27) |
      bitnumIntl(s, 21, 28) |
      bitnumIntl(s, 10, 29) |
      bitnumIntl(s, 3, 30) |
      bitnumIntl(s, 24, 31)) >>>
    0
  )
}

type Schedule = Uint8Array[] // [16][6]

function desCrypt(input: Uint8Array, key: Schedule, output: Uint8Array): void {
  let [s0, s1] = initialPermutation(input)
  for (let i = 0; i < 15; i++) {
    const prev = s1
    s1 = (desF(s1, key[i]) ^ s0) >>> 0
    s0 = prev
  }
  s0 = (desF(s1, key[15]) ^ s0) >>> 0
  inversePermutation(s0, s1, output)
}

function keySchedule(key: Uint8Array, mode: number): Schedule {
  const schedule: Schedule = Array.from({ length: 16 }, () => new Uint8Array(6))
  let c = 0
  let d = 0
  for (let i = 0; i < 28; i++) {
    c = (c | bitnum(key, KEY_PERM_C[i], 31 - i)) >>> 0
    d = (d | bitnum(key, KEY_PERM_D[i], 31 - i)) >>> 0
  }
  for (let i = 0; i < 16; i++) {
    const sh = KEY_RND_SHIFT[i]
    c = (((c << sh) | (c >>> (28 - sh))) & 0xfffffff0) >>> 0
    d = (((d << sh) | (d >>> (28 - sh))) & 0xfffffff0) >>> 0
    const togen = mode === DES_DECRYPT ? 15 - i : i
    for (let j = 0; j < 6; j++) schedule[togen][j] = 0
    for (let j = 0; j < 24; j++)
      schedule[togen][(j / 8) | 0] |= bitnumIntr(c, KEY_COMPRESSION[j], 7 - (j % 8))
    for (let j = 24; j < 48; j++)
      schedule[togen][(j / 8) | 0] |= bitnumIntr(d, KEY_COMPRESSION[j] - 27, 7 - (j % 8))
  }
  return schedule
}

const QRC_KEY = new Uint8Array([
  0x21, 0x40, 0x23, 0x29, 0x28, 0x2a, 0x24, 0x25, 0x31, 0x32, 0x33, 0x5a, 0x58, 0x43, 0x21, 0x40,
  0x21, 0x40, 0x23, 0x29, 0x28, 0x4e, 0x48, 0x4c
]) // "!@#)(*$%123ZXC!@!@#)(NHL"

// tripledes_key_setup(key, DES_DECRYPT)
const SCHEDULE: [Schedule, Schedule, Schedule] = [
  keySchedule(QRC_KEY.subarray(16, 24), DES_DECRYPT),
  keySchedule(QRC_KEY.subarray(8, 16), DES_ENCRYPT),
  keySchedule(QRC_KEY.subarray(0, 8), DES_DECRYPT)
]

function tripledesCrypt(input: Uint8Array, output: Uint8Array): void {
  const buf = new Uint8Array(8)
  desCrypt(input, SCHEDULE[0], buf)
  desCrypt(buf, SCHEDULE[1], output)
  desCrypt(output, SCHEDULE[2], buf)
  output.set(buf)
}

/**
 * QRC 三重 DES 解密（ECB，就地按 8 字节块；不足 8 字节的尾块保持原样，对齐 C++）。
 * 返回解密后待 zlib inflate 的字节。
 */
export function qqQrcDecrypt(data: Buffer): Buffer {
  const out = Buffer.from(data) // 复制，避免改动入参
  const block = new Uint8Array(8)
  const res = new Uint8Array(8)
  for (let i = 0; i + 8 <= out.length; i += 8) {
    block.set(out.subarray(i, i + 8))
    tripledesCrypt(block, res)
    out.set(res, i)
  }
  return out
}
