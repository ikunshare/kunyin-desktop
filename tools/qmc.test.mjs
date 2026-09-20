/**
 * QMC（QQ 音乐 mflac/mgg）解密的一致性回归。
 *
 * 两条实现必须永远逐字节一致：
 * - wasm 后端  native/qmc-wasm/src/lib.rs（默认走这条）
 * - 纯 JS 回退 src/main/crypto/mflac.ts 的 MapCipher / Rc4Cipher
 *
 * 另外钉死了几组输出摘要：光比较「两边一致」挡不住两边被一起改坏，
 * 而这套算法是对着线上真实文件的，改坏了等于所有加密音源静默播放噪音。
 *
 * 跑：npm test
 */
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createCipher, createJsCipher, decryptFileWith } from '../src/main/crypto/mflac.ts'
import { createWasmCipher, qmcWasmStatus } from '../src/main/crypto/qmcWasm.ts'

/** 确定性伪随机字节（LCG），避免测试用例每次不同 */
function bytes(n, seed = 1) {
  const a = new Uint8Array(n)
  let x = seed >>> 0
  for (let i = 0; i < n; i++) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0
    a[i] = (x >>> 24) & 0xff
  }
  return a
}

const sha = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 32)

before(() => {
  const status = qmcWasmStatus()
  assert.equal(
    status.available,
    true,
    `wasm 后端不可用（${status.reason}）。若刚改过 native/qmc-wasm，请先 npm run build:wasm`
  )
})

test('wasm 与纯 JS 实现逐字节一致', () => {
  // 覆盖两个分支的选型边界（≤300 走 map，>300 走 RC4）
  const keyLens = [1, 2, 7, 64, 128, 255, 300, 301, 400, 512, 700, 1024, 4096]
  // 关键偏移：0、段一内部、跨 0x80 与 0x1400（RC4 分段）、跨 0x7fff（map 折回）、大偏移
  const offsets = [
    0, 1, 0x7f, 0x80, 0x81, 0x13ff, 0x1400, 0x1401, 0x2800, 0x7ffe, 0x7fff, 0x8000, 0x8001, 0xfffe,
    0xffff, 0x10000, 1234567, 99999999
  ]
  // 关键长度：跨 8 字节 XOR 主循环的尾巴、跨 wasm 的 128KB IO 窗口
  const lens = [1, 7, 8, 9, 0x80, 0x1400, 0x1400 + 3, 131071, 131072, 131073, 300000]

  let cases = 0
  for (const keyLen of keyLens) {
    const key = bytes(keyLen, keyLen * 31 + 7)
    const js = createJsCipher(key)
    const wasm = createWasmCipher(key, keyLen <= 300 ? 'map' : 'rc4')
    assert.ok(wasm, `keyLen=${keyLen} 没造出 wasm 解密器`)

    for (const offset of offsets) {
      for (const len of lens) {
        const data = Buffer.from(bytes(len, len + offset + keyLen))
        assert.deepEqual(
          wasm.decrypt(data, offset),
          js.decrypt(data, offset),
          `不一致：keyLen=${keyLen} offset=${offset} len=${len}`
        )
        cases++
      }
    }
  }
  assert.ok(cases > 2000, `用例数偏少（${cases}）`)
})

test('分块喂与整块喂结果相同（Range/seek 的正确性前提）', () => {
  for (const keyLen of [256, 512]) {
    const key = bytes(keyLen, keyLen)
    const total = Buffer.from(bytes(400000, 99))
    const base = 0x7f00 // 让分块边界落在 map 折回点与 RC4 段边界附近

    const whole = createCipher(key).decrypt(total, base)

    for (const chunk of [1, 3, 0x80, 0x1400, 65536]) {
      const cipher = createCipher(key)
      const parts = []
      for (let pos = 0; pos < total.length; pos += chunk) {
        const slice = total.subarray(pos, Math.min(pos + chunk, total.length))
        parts.push(cipher.decrypt(slice, base + pos))
      }
      assert.deepEqual(
        Buffer.concat(parts),
        whole,
        `keyLen=${keyLen} chunk=${chunk} 分块结果与整块不一致`
      )
    }
  }
})

test('decryptFileWith 原地分块解密与内存解密一致', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qmc-test-'))
  try {
    for (const keyLen of [256, 512]) {
      const key = bytes(keyLen, keyLen + 1)
      // 跨过 1MB 的分块边界，确保拼接点没错位
      const plainSource = Buffer.from(bytes(1024 * 1024 + 4096, 42))
      const expected = createCipher(key).decrypt(plainSource, 0)

      const path = join(dir, `sample-${keyLen}.bin`)
      writeFileSync(path, plainSource)
      await decryptFileWith(createCipher(key), path)

      assert.deepEqual(readFileSync(path), expected, `keyLen=${keyLen} 文件解密结果不一致`)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('输出摘要未漂移（防止两条实现被一起改坏）', () => {
  // 期望值由本测试首次运行时的实现产出并人工核对；除非确认线上格式变了，否则不许改。
  const vectors = [
    { keyLen: 256, offset: 0, len: 65536, digest: 'dcbe85c4e07cbd3d4a1cddd1ec91808c' },
    { keyLen: 256, offset: 0x7ff0, len: 65536, digest: 'b97d24fa2113bb20fa3fdf577ae9d1df' },
    { keyLen: 512, offset: 0, len: 65536, digest: 'd245386be5aa4a5a7efb33b168ce5b9d' },
    { keyLen: 512, offset: 0x1400, len: 65536, digest: '5728d09ab50f23d2b8a2eee0e747d8c6' }
  ]
  for (const v of vectors) {
    const key = bytes(v.keyLen, v.keyLen * 31 + 7)
    const data = Buffer.from(bytes(v.len, 0xabc))
    assert.equal(
      sha(createCipher(key).decrypt(data, v.offset)),
      v.digest,
      `摘要漂移：keyLen=${v.keyLen} offset=${v.offset}`
    )
  }
})
