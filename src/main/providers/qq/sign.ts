/**
 * QQ 音乐 musics.fcg 的 zzc 签名（移植自 lx-music-desktop tx/utils/crypto.js，用户指定为准）。
 *
 * musicu.fcg 无签名在真机 App 上可用，但桌面/数据中心 IP 会被风控（svc.code=2001，
 * sum=0）；签名走 musics.fcg 即恢复正常。sign 必须对「实际发送的 body 字节」计算。
 */
import { createHash } from 'node:crypto'

const PART_1_INDEXES = [23, 14, 6, 36, 16, 40, 7, 19]
const PART_2_INDEXES = [16, 1, 32, 12, 19, 27, 8, 5]
const SCRAMBLE_VALUES = [
  89, 39, 179, 150, 218, 82, 58, 252, 177, 52, 186, 123, 120, 64, 242, 133, 143, 161, 121, 179
]

export function zzcSign(text: string): string {
  const hash = createHash('sha1').update(text).digest('hex')
  const part1 = PART_1_INDEXES.map((i) => hash[i]).join('')
  const part2 = PART_2_INDEXES.map((i) => hash[i]).join('')
  const part3 = SCRAMBLE_VALUES.map((v, i) => v ^ parseInt(hash.slice(i * 2, i * 2 + 2), 16))
  const b64Part = Buffer.from(part3)
    .toString('base64')
    .replace(/[\\/+=]/g, '')
  return `zzc${part1}${b64Part}${part2}`.toLowerCase()
}
