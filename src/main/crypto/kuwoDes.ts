/**
 * 酷我改版 DES（1:1 移植自 kuwodes.py，密钥固定 `ylzsxkwm`）。
 *
 * 用途：`mobilebasedata.kuwo.cn/api/music/info` 的 `q` 参数 = base64(DES 加密(明文参数串))。
 * 注意是**改版 DES**（S-box、置换表自定义），标准 DES 无法匹配，必须逐位复刻。
 * JS number 只有 53bit 整数精度，故全链用 BigInt 保证 64bit 位运算精确。
 */

// prettier-ignore
const E = [31, 0, 1, 2, 3, 4, -1, -1, 3, 4, 5, 6, 7, 8, -1, -1, 7, 8, 9, 10, 11, 12, -1, -1, 11, 12, 13, 14, 15, 16, -1, -1, 15, 16, 17, 18, 19, 20, -1, -1, 19, 20, 21, 22, 23, 24, -1, -1, 23, 24, 25, 26, 27, 28, -1, -1, 27, 28, 29, 30, 31, 30, -1, -1]
// prettier-ignore
const P = [15, 6, 19, 20, 28, 11, 27, 16, 0, 14, 22, 25, 4, 17, 30, 9, 1, 7, 23, 13, 31, 26, 2, 8, 18, 12, 29, 5, 21, 10, 3, 24]
// prettier-ignore
const IP = [57, 49, 41, 33, 25, 17, 9, 1, 59, 51, 43, 35, 27, 19, 11, 3, 61, 53, 45, 37, 29, 21, 13, 5, 63, 55, 47, 39, 31, 23, 15, 7, 56, 48, 40, 32, 24, 16, 8, 0, 58, 50, 42, 34, 26, 18, 10, 2, 60, 52, 44, 36, 28, 20, 12, 4, 62, 54, 46, 38, 30, 22, 14, 6]
// prettier-ignore
const IP_1 = [39, 7, 47, 15, 55, 23, 63, 31, 38, 6, 46, 14, 54, 22, 62, 30, 37, 5, 45, 13, 53, 21, 61, 29, 36, 4, 44, 12, 52, 20, 60, 28, 35, 3, 43, 11, 51, 19, 59, 27, 34, 2, 42, 10, 50, 18, 58, 26, 33, 1, 41, 9, 49, 17, 57, 25, 32, 0, 40, 8, 48, 16, 56, 24]
// prettier-ignore
const PC_1 = [56, 48, 40, 32, 24, 16, 8, 0, 57, 49, 41, 33, 25, 17, 9, 1, 58, 50, 42, 34, 26, 18, 10, 2, 59, 51, 43, 35, 62, 54, 46, 38, 30, 22, 14, 6, 61, 53, 45, 37, 29, 21, 13, 5, 60, 52, 44, 36, 28, 20, 12, 4, 27, 19, 11, 3]
// prettier-ignore
const PC_2 = [13, 16, 10, 23, 0, 4, -1, -1, 2, 27, 14, 5, 20, 9, -1, -1, 22, 18, 11, 3, 25, 7, -1, -1, 15, 6, 26, 19, 12, 1, -1, -1, 40, 51, 30, 36, 46, 54, -1, -1, 29, 39, 50, 44, 32, 47, -1, -1, 43, 48, 38, 55, 33, 52, -1, -1, 45, 41, 49, 35, 28, 31, -1, -1]
// prettier-ignore
const MATRIX_NS_BOX = [
  [14, 4, 3, 15, 2, 13, 5, 3, 13, 14, 6, 9, 11, 2, 0, 5, 4, 1, 10, 12, 15, 6, 9, 10, 1, 8, 12, 7, 8, 11, 7, 0, 0, 15, 10, 5, 14, 4, 9, 10, 7, 8, 12, 3, 13, 1, 3, 6, 15, 12, 6, 11, 2, 9, 5, 0, 4, 2, 11, 14, 1, 7, 8, 13],
  [15, 0, 9, 5, 6, 10, 12, 9, 8, 7, 2, 12, 3, 13, 5, 2, 1, 14, 7, 8, 11, 4, 0, 3, 14, 11, 13, 6, 4, 1, 10, 15, 3, 13, 12, 11, 15, 3, 6, 0, 4, 10, 1, 7, 8, 4, 11, 14, 13, 8, 0, 6, 2, 15, 9, 5, 7, 1, 10, 12, 14, 2, 5, 9],
  [10, 13, 1, 11, 6, 8, 11, 5, 9, 4, 12, 2, 15, 3, 2, 14, 0, 6, 13, 1, 3, 15, 4, 10, 14, 9, 7, 12, 5, 0, 8, 7, 13, 1, 2, 4, 3, 6, 12, 11, 0, 13, 5, 14, 6, 8, 15, 2, 7, 10, 8, 15, 4, 9, 11, 5, 9, 0, 14, 3, 10, 7, 1, 12],
  [7, 10, 1, 15, 0, 12, 11, 5, 14, 9, 8, 3, 9, 7, 4, 8, 13, 6, 2, 1, 6, 11, 12, 2, 3, 0, 5, 14, 10, 13, 15, 4, 13, 3, 4, 9, 6, 10, 1, 12, 11, 0, 2, 5, 0, 13, 14, 2, 8, 15, 7, 4, 15, 1, 10, 7, 5, 6, 12, 11, 3, 8, 9, 14],
  [2, 4, 8, 15, 7, 10, 13, 6, 4, 1, 3, 12, 11, 7, 14, 0, 12, 2, 5, 9, 10, 13, 0, 3, 1, 11, 15, 5, 6, 8, 9, 14, 14, 11, 5, 6, 4, 1, 3, 10, 2, 12, 15, 0, 13, 2, 8, 5, 11, 8, 0, 15, 7, 14, 9, 4, 12, 7, 10, 9, 1, 13, 6, 3],
  [12, 9, 0, 7, 9, 2, 14, 1, 10, 15, 3, 4, 6, 12, 5, 11, 1, 14, 13, 0, 2, 8, 7, 13, 15, 5, 4, 10, 8, 3, 11, 6, 10, 4, 6, 11, 7, 9, 0, 6, 4, 2, 13, 1, 9, 15, 3, 8, 15, 3, 1, 14, 12, 5, 11, 0, 2, 12, 14, 7, 5, 10, 8, 13],
  [4, 1, 3, 10, 15, 12, 5, 0, 2, 11, 9, 6, 8, 7, 6, 9, 11, 4, 12, 15, 0, 3, 10, 5, 14, 13, 7, 8, 13, 14, 1, 2, 13, 6, 14, 9, 4, 1, 2, 14, 11, 13, 5, 0, 1, 10, 8, 3, 0, 11, 3, 5, 9, 4, 15, 2, 7, 8, 12, 15, 10, 7, 6, 12],
  [13, 7, 10, 0, 6, 9, 5, 15, 8, 4, 3, 10, 11, 14, 12, 5, 2, 11, 9, 6, 15, 12, 0, 3, 4, 1, 14, 13, 1, 2, 7, 8, 1, 2, 12, 15, 10, 4, 0, 3, 13, 14, 6, 9, 7, 8, 9, 6, 15, 1, 5, 12, 3, 10, 14, 5, 8, 7, 11, 0, 4, 13, 2, 11],
]
const LS = [1, 1, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 1]
const LS_MASK = [0n, 0x100001n, 0x300003n]

/** MASK[i] = 1 << i（Python KEYS.MASK，BigInt 版） */
const MASK: bigint[] = []
for (let i = 0; i < 64; i++) MASK[i] = 1n << BigInt(i)

const KEY = Buffer.from('ylzsxkwm', 'latin1')

/** 按置换表 array 把 source 的位收集到 length 位输出（对应 createBitTransform）。 */
function bitTransform(array: number[], length: number, source: bigint): bigint {
  let dest = 0n
  for (let i = 0; i < length; i++) {
    const bit = array[i]
    if (bit >= 0 && (source & MASK[bit]) !== 0n) dest |= MASK[i]
  }
  return dest
}

/** PC-1 + 16 轮循环左移 + PC-2 → 16 个子密钥（对应 createDesSubKeys）。 */
function createDesSubKeys(key: bigint, decrypt: boolean): bigint[] {
  let temp = bitTransform(PC_1, 56, key)
  const K: bigint[] = new Array(16)
  for (let j = 0; j < 16; j++) {
    const source = temp
    const shift = LS[j]
    temp =
      ((source & LS_MASK[shift]) << BigInt(28 - shift)) |
      ((source & ~LS_MASK[shift]) >> BigInt(shift))
    K[j] = bitTransform(PC_2, 64, temp)
  }
  if (decrypt) {
    for (let j = 0; j < 8; j++) {
      const t = K[j]
      K[j] = K[15 - j]
      K[15 - j] = t
    }
  }
  return K
}

/** 单块 64bit 加密（IP → 16 轮 Feistel → 交换 → IP-1，对应 createDes64）。 */
function des64(subkeys: bigint[], data: bigint): bigint {
  let out = bitTransform(IP, 64, data)
  let left = out & 0xffffffffn
  let right = (out >> 32n) & 0xffffffffn

  for (let i = 0; i < 16; i++) {
    let r = bitTransform(E, 64, right)
    r ^= subkeys[i]
    let sOut = 0n
    for (let sbi = 7; sbi >= 0; sbi--) {
      const pR = Number((r >> BigInt(sbi * 8)) & 0xffn)
      sOut = (sOut << 4n) | BigInt(MATRIX_NS_BOX[sbi][pR])
    }
    r = bitTransform(P, 32, sOut)
    const l = left
    left = right
    right = l ^ r
  }

  out = ((left & 0xffffffffn) << 32n) | (right & 0xffffffffn)
  return bitTransform(IP_1, 64, out)
}

/**
 * 酷我 DES 加密（对应 kuwodes.py KuwoDes.encrypt）。
 * 明文按 8 字节分块，尾块不足 8 字节也补成一个完整块，输出 (num+1)*8 字节。
 */
export function kuwoDesEncrypt(content: Uint8Array): Buffer {
  const contentLength = content.length
  const keyl = KEY.reduce((acc, b, i) => acc | (BigInt(b) << BigInt(i * 8)), 0n)
  const subkeys = createDesSubKeys(keyl, false)

  const num = Math.floor(contentLength / 8)
  const out = Buffer.alloc((num + 1) * 8)
  for (let i = 0; i < num; i++) {
    let block = 0n
    for (let j = 0; j < 8; j++) block |= BigInt(content[i * 8 + j]) << BigInt(j * 8)
    const enc = des64(subkeys, block)
    for (let j = 0; j < 8; j++) out[i * 8 + j] = Number((enc >> BigInt(j * 8)) & 0xffn)
  }
  let tail = 0n
  for (let i = 0; i < contentLength - num * 8; i++) {
    tail |= BigInt(content[num * 8 + i]) << BigInt(i * 8)
  }
  const encTail = des64(subkeys, tail)
  for (let j = 0; j < 8; j++) out[num * 8 + j] = Number((encTail >> BigInt(j * 8)) & 0xffn)
  return out
}

/** base64(DES 加密(明文))，对应 kuwodes.py createEncrypt。 */
export function kuwoEncryptBase64(plain: string): string {
  return kuwoDesEncrypt(Buffer.from(plain, 'utf-8')).toString('base64')
}
