/**
 * 网易云埋点日志封包 NCBL（src/main/crypto/ncbl.ts）的回归。
 *
 * 这一层不触网、不依赖 Electron，但错一个字节服务端就整包静默丢弃、连错误码都没有，
 * 所以把「格式布局」和「密钥包裹」都钉死在这里：
 * - 头部各字段的偏移与取值（magic / 版本 / 头长 / 记录区长度 / 序号区间）；
 * - nonce 与计数器的派生方式（计数器是 uuid[12..15] 的 u32 **右移 2 位**）；
 * - KEY_A 首字节必须夹到 ≤ 0xA2，否则裸 RSA 包裹出来的 KEY_B 还原不回去。
 *
 * 跑：npm test
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'

import {
  buildRecord,
  buildRecords,
  chacha20,
  decryptNcbl,
  encryptNcbl,
  rsaUnWrap,
  rsaWrap
} from '../src/main/crypto/ncbl.ts'

const META = JSON.stringify({ MUSIC_U: 'deadbeef', os: 'pc', appver: '3.1.35.205293' })

test('记录格式：<时刻>\\x01<动作>\\x01<JSON>', () => {
  const line = buildRecord({ time: 1700000000, action: '_plv', data: { id: '123' } })
  assert.equal(line, '1700000000\u0001_plv\u0001{"id":"123"}')
  // 已经是字符串的 data 原样带过去（不二次 JSON.stringify）
  assert.equal(
    buildRecord({ time: 1, action: '_pld', data: '{"a":1}' }),
    '1\u0001_pld\u0001{"a":1}'
  )
})

test('多条记录之间没有分隔符——所以上报侧一次只封一条', () => {
  const a = { time: 1, action: '_plv', data: '{}' }
  const b = { time: 2, action: '_pld', data: '{}' }
  assert.equal(buildRecords([a, b]), buildRecord(a) + buildRecord(b))
})

test('裸 RSA 包裹可逆（KEY_A 首字节 ≤ 0xA2 时）', () => {
  const keyA = Buffer.alloc(32, 0x11)
  keyA[0] = 0xa2
  assert.deepEqual(rsaUnWrap(rsaWrap(keyA)), keyA)
})

test('KEY_A 首字节 ≥ 0xA3 会超过模数 N，封包时必须夹住', () => {
  const tooBig = Buffer.alloc(32, 0xff)
  // 不夹：mod N 之后信息已经丢了，还原不回原值
  assert.notDeepEqual(rsaUnWrap(rsaWrap(tooBig)), tooBig)
  // 封包里夹到 0xA2，于是解包能拿回同一把 KEY_A
  const payload = encryptNcbl({ meta: META, body: 'x' }, { keyA: Buffer.from(tooBig) })
  const clamped = Buffer.from(tooBig)
  clamped[0] = 0xa2
  assert.deepEqual(decryptNcbl(payload).extra.keyA, clamped)
})

test('封包 → 解包往返：元信息与记录区都能原样取回', () => {
  const body = buildRecords([
    { time: 1700000000, action: '_plv', data: { id: '2651562175', bitrate: 320 } },
    { time: 1700000100, action: '_pld', data: { id: '2651562175', time: 101 } }
  ])
  const payload = encryptNcbl({ meta: META, body })
  const out = decryptNcbl(payload)
  assert.equal(out.meta.toString('utf-8'), META)
  assert.equal(out.body.toString('utf-8'), body)
  assert.equal(out.extra.version, 3)
})

test('头部布局：magic / 版本 / 头长 / 记录区长度 / 序号区间', () => {
  const uuid = Buffer.from('0102030405060708090a0b0c0d0e0f10', 'hex')
  const keyA = Buffer.alloc(32, 0x42)
  const payload = encryptNcbl({ meta: META, body: 'hello' }, { uuid, keyA, baseSeq: 7 })

  assert.equal(payload.subarray(0, 4).toString('ascii'), 'NCBL')
  assert.equal(payload.readUInt32LE(4), 3)

  const headerLen = payload.readUInt16LE(8)
  // 头 = 固定 70 字节 + [u16 type][u16 len] + 元信息密文
  assert.equal(headerLen, 70 + 4 + Buffer.byteLength(META, 'utf-8'))
  assert.equal(payload.readUInt16LE(70), 0x4343)
  assert.deepEqual(payload.subarray(10, 26), uuid)
  assert.deepEqual(payload.subarray(26, 58), rsaWrap(keyA))
  assert.equal(payload.readUInt32LE(58), 7)
  // 单帧：首尾序号相同
  assert.equal(payload.readUInt32LE(62), 7)
  assert.equal(payload.readUInt32LE(66), payload.length - headerLen)
})

test('nonce 取 uuid 前 12 字节，计数器是 uuid[12..15] 的 u32 右移 2 位', () => {
  const uuid = Buffer.alloc(16)
  uuid.writeUInt32LE(0xdeadbeef, 12)
  const out = decryptNcbl(encryptNcbl({ meta: META, body: 'x' }, { uuid }))
  assert.deepEqual(out.extra.nonce, uuid.subarray(0, 12))
  assert.equal(out.extra.counter, 0xdeadbeef >>> 2)
})

test('元信息块用 KEY_B 加密、记录区用 KEY_A（两把混用就解不开）', () => {
  const uuid = Buffer.from('101112131415161718191a1b1c1d1e1f', 'hex')
  const keyA = Buffer.alloc(32, 0x37)
  const payload = encryptNcbl({ meta: META, body: 'body' }, { uuid, keyA, baseSeq: 1 })
  const { nonce, counter, keyB } = decryptNcbl(payload).extra

  const headerLen = payload.readUInt16LE(8)
  const metaLen = payload.readUInt16LE(72)
  const metaCipher = payload.subarray(74, 74 + metaLen)
  assert.equal(chacha20(keyB, counter, nonce, metaCipher).toString('utf-8'), META)
  // 拿 KEY_A 解元信息只会得到乱码
  assert.notEqual(chacha20(keyA, counter, nonce, metaCipher).toString('utf-8'), META)
  assert.equal(headerLen, 74 + metaLen)
})

test('大 body 会切成多帧，序号连续递增', () => {
  // 压完仍要 > maxFrame 才会真的切帧，所以用不可压缩的随机字节（有规律的序列 zstd 一压就没了）
  const noise = randomBytes(200 * 1024)
  const payload = encryptNcbl({ meta: META, body: noise }, { baseSeq: 100, maxFrame: 4096 })
  const first = payload.readUInt32LE(58)
  const last = payload.readUInt32LE(62)
  assert.equal(first, 100)
  assert.ok(last > first, `期望切成多帧，实际 first=${first} last=${last}`)

  // 逐帧走一遍，序号必须是 first..last 连续
  const headerLen = payload.readUInt16LE(8)
  const trailing = payload.subarray(headerLen)
  const seqs = []
  for (let pos = 0; pos + 6 <= trailing.length;) {
    const len = trailing.readUInt16LE(pos)
    seqs.push(trailing.readUInt32LE(pos + 2))
    pos += 6 + len
  }
  assert.deepEqual(
    seqs,
    Array.from({ length: last - first + 1 }, (_, i) => first + i)
  )
  assert.deepEqual(decryptNcbl(payload).body, noise)
})
