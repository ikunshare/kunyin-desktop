/**
 * AC-3 / E-AC-3 软解（src/main/audio/dolbyDecoder.ts + native/dolby-wasm）的回归。
 * AC-4 没有开源编码器、做不出夹具，它的路径在 dolbyStream.test.mjs 里用假解码器钉。
 *
 * 夹具是 ffmpeg 生成的正弦：每个声道一个频率，靠频率认声道——
 *   5.1：FL 300 / FR 500 / FC 700 / LFE 60 / SL 900 / SR 1100 Hz
 *   stereo：L 440 / R 1000 Hz
 * 重新生成见 tools/fixtures/README.md。
 *
 * 解码正确性另外对照过原生 ffmpeg：同一夹具逐样本最大误差 4.5e-8（浮点舍入量级），样本数一致；
 * 真实文件的对照见 dolbyStream.test.mjs 文件头。这里只钉住能在 CI 里自证的性质。
 *
 * 跑：npm test
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { createDolbyDecoder, dolbyWasmStatus } from '../src/main/audio/dolbyDecoder.ts'

const fixture = (name) =>
  new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)))

/** 按 chunk 大小切块喂完整个文件，拼成一段 PCM */
function decodeAll(bytes, opts = {}, chunkSizes = [bytes.length]) {
  const dec = createDolbyDecoder({ codec: 'ac3', ...opts })
  assert.ok(dec, 'wasm 解码器应可用')
  const parts = []
  let i = 0
  let k = 0
  while (i < bytes.length) {
    const n = chunkSizes[k++ % chunkSizes.length]
    parts.push(...dec.decode(bytes.subarray(i, i + n)))
    i += n
  }
  parts.push(...dec.flush())
  const errors = dec.errors
  dec.close()
  assert.ok(parts.length > 0, '应解出 PCM')
  const { channels, sampleRate } = parts[0]
  for (const p of parts) assert.equal(p.channels, channels, '夹具的声道数不会中途变')
  const frames = parts.reduce((n, p) => n + p.frames, 0)
  const data = new Float32Array(frames * channels)
  let off = 0
  for (const p of parts) {
    data.set(p.data, off)
    off += p.data.length
  }
  return { channels, sampleRate, frames, data, errors }
}

/** Goertzel：某声道在频率 f 上的功率（跳过开头的编码器过渡） */
function power(pcm, ch, f) {
  const start = 4096
  const n = Math.min(pcm.frames - start, 32768)
  const w = (2 * Math.PI * f) / pcm.sampleRate
  const coeff = 2 * Math.cos(w)
  let s1 = 0
  let s2 = 0
  for (let i = 0; i < n; i++) {
    const s0 = pcm.data[(start + i) * pcm.channels + ch] + coeff * s1 - s2
    s2 = s1
    s1 = s0
  }
  return (s1 * s1 + s2 * s2 - coeff * s1 * s2) / (n * n)
}

const FREQS_51 = [300, 500, 700, 60, 900, 1100]

function assertChannelTones(pcm, freqs) {
  freqs.forEach((f, ch) => {
    const own = power(pcm, ch, f)
    for (const other of freqs) {
      if (other === f) continue
      assert.ok(
        own > 1000 * power(pcm, ch, other),
        `声道 ${ch} 应只含 ${f} Hz（混进了 ${other} Hz）`
      )
    }
  })
}

test('wasm 模块能编译', () => {
  assert.deepEqual(dolbyWasmStatus(), { available: true })
})

test('AC-3 5.1：声道数、采样率、时长、声道次序', () => {
  const pcm = decodeAll(fixture('sine-5.1.ac3'))
  assert.equal(pcm.channels, 6)
  assert.equal(pcm.sampleRate, 48000)
  // 编码器把 1 秒切成了 31 个整帧（与原生 ffmpeg 解出的样本数一致）
  assert.equal(pcm.frames, 31 * 1536)
  assert.equal(pcm.errors, 0)
  assertChannelTones(pcm, FREQS_51)
})

test('E-AC-3 5.1 与立体声', () => {
  const surround = decodeAll(fixture('sine-5.1.eac3'))
  assert.equal(surround.channels, 6)
  assert.equal(surround.frames, 31 * 1536)
  assert.equal(surround.errors, 0)
  assertChannelTones(surround, FREQS_51)

  const stereo = decodeAll(fixture('sine-stereo.eac3'))
  assert.equal(stereo.channels, 2)
  assert.equal(stereo.frames, 32 * 1536)
  assert.equal(stereo.errors, 0)
  assertChannelTones(stereo, [440, 1000])
})

test('按码流下混系数混成立体声：左不串右，LFE 不进下混', () => {
  for (const name of ['sine-5.1.ac3', 'sine-5.1.eac3']) {
    const pcm = decodeAll(fixture(name), { stereo: true })
    assert.equal(pcm.channels, 2, name)
    const [L, R] = [0, 1]
    // 左 = FL + C + SL，右 = FR + C + SR
    for (const f of [300, 700, 900]) assert.ok(power(pcm, L, f) > 100 * power(pcm, L, 500), name)
    for (const f of [500, 700, 1100]) assert.ok(power(pcm, R, f) > 100 * power(pcm, R, 300), name)
    assert.ok(power(pcm, L, 60) < power(pcm, L, 300) / 1000, `${name}：LFE 不该混进来`)
  }
})

test('任意切块喂进去，结果与整块一次喂逐样本相同（取流按块到达的前提）', () => {
  for (const name of ['sine-5.1.ac3', 'sine-5.1.eac3', 'sine-stereo.eac3']) {
    const bytes = fixture(name)
    const whole = decodeAll(bytes)
    for (const sizes of [[1], [7, 333, 4096], [1791]]) {
      const chunked = decodeAll(bytes, {}, sizes)
      assert.equal(chunked.frames, whole.frames, `${name} 切成 ${sizes}`)
      assert.deepEqual(chunked.data, whole.data, `${name} 切成 ${sizes}`)
    }
  }
})

test('坏数据：前面有垃圾、中间有帧被破坏，照样往下解不抛错', () => {
  const good = fixture('sine-5.1.ac3')
  const junk = new Uint8Array(3000).map((_, i) => (i * 131) & 0xff)
  const bytes = new Uint8Array(junk.length + good.length)
  bytes.set(junk)
  bytes.set(good, junk.length)
  // 砸坏第 10 帧附近的一段（AC-3 448k 每帧 1792 字节）
  bytes.fill(0x5a, junk.length + 1792 * 10 + 100, junk.length + 1792 * 10 + 600)
  const pcm = decodeAll(bytes)
  assert.equal(pcm.channels, 6)
  // 砸坏的那帧最多丢掉它自己和紧邻的一帧
  assert.ok(pcm.frames >= (31 - 2) * 1536, `只解出 ${pcm.frames}`)
})

test('reset 后从头再喂，与新开一路解码器结果相同（seek 的前提）', () => {
  const bytes = fixture('sine-5.1.eac3')
  const fresh = decodeAll(bytes)
  const dec = createDolbyDecoder({ codec: 'ac3' })
  dec.decode(bytes.subarray(0, 20000))
  dec.reset()
  const parts = [...dec.decode(bytes), ...dec.flush()]
  dec.close()
  const frames = parts.reduce((n, p) => n + p.frames, 0)
  assert.equal(frames, fresh.frames)
  assert.deepEqual(
    parts.map((p) => p.data).flatMap((d) => [...d]),
    [...fresh.data]
  )
})

test('解码速度远快于实时（播放要边下边解）', () => {
  const bytes = fixture('sine-5.1.ac3')
  const t0 = performance.now()
  let seconds = 0
  for (let i = 0; i < 10; i++) {
    const pcm = decodeAll(bytes)
    seconds += pcm.frames / pcm.sampleRate
  }
  const speed = seconds / ((performance.now() - t0) / 1000)
  assert.ok(speed > 10, `只有 ${speed.toFixed(1)}× 实时`)
})
