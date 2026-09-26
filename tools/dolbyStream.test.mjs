/**
 * 杜比软解流（src/main/audio/dolbyStream.ts + mp4.ts）的回归：MP4 里的 AC-3 / E-AC-3 / AC-4 → WAV 字节流。
 *
 * 夹具是 tools/fixtures 里正弦 .ac3 / .eac3 用 ffmpeg `-c copy` 封进 MP4 的（生成方法见 fixtures/README.md），
 * 两个文件恰好覆盖两种布局：
 *   sine-5.1-eac3.mp4  faststart（ftyp → moov → free → mdat），QQ 杜比文件就是这种
 *   sine-5.1-ac3.mp4   moov 在尾部（ftyp → free → mdat → moov），ffmpeg 默认输出
 *
 * 真实的 QQ 杜比文件（E-AC-3 JOC 5.1，448kbps，200s）另外对照过 LibreMPEG 原生 ffmpeg
 * `-downmix stereo`：整段逐样本最大误差 5e-8，解码约 540× 实时，首播读 moov 与读音频共用一条连接。
 * （与 FFmpeg 上游差 3e-5：两个分支的 AC-3 解码器实现有细微分歧，约 -90dB，听不出。）
 *
 * AC-4 没有开源编码器，做不出夹具：这里现场拼一个带 ac-4 样本描述与 stss 的最小 MP4，用假解码器
 * 模拟 AC-4 的脾气（I 帧之前不出声、冷启动头两帧不准、坏帧不出声），钉住时间轴对齐与 seek 预热。
 * 真实解码另外用网易的杜比文件（AC-4 IMS，256kbps，200s）对照过 LibreMPEG 原生 ffmpeg：
 * 整段逐样本最大误差 4.5e-7，约 56× 实时；从 I 帧起解第 1 帧误差 0.3、第 2 帧 5e-2、第 3 帧起完全一致。
 *
 * 跑：npm test
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { createDolbyDecoder } from '../src/main/audio/dolbyDecoder.ts'
import {
  createByteCursor,
  decodeToWav,
  loadTrack,
  wavHeader,
  wavLayout
} from '../src/main/audio/dolbyStream.ts'
import { Mp4Error, parseMoov, sampleAtFrame, syncAtOrBefore } from '../src/main/audio/mp4.ts'

const fixture = (name) =>
  new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)))

/**
 * 用内存里的文件模拟上游：每次 open 是一次新的 Range 回源，记下起点；
 * 块大小故意不规整（取流按块到达，块边界不会落在样本边界上）。
 */
function memorySource(file, opts = {}) {
  const log = { opens: [], cancelled: 0 }
  const chunk = opts.chunk ?? ((pos) => 3000 + (pos % 997))
  const open = async (start) => {
    log.opens.push(start)
    let pos = start
    const end = opts.truncateAt ?? file.length
    return {
      size: file.length,
      body: new ReadableStream({
        pull(c) {
          if (opts.failAt !== undefined && pos >= opts.failAt) {
            c.error(new Error('上游断了'))
            return
          }
          if (pos >= end) {
            c.close()
            return
          }
          const n = Math.min(chunk(pos), end - pos)
          c.enqueue(file.slice(pos, pos + n))
          pos += n
        },
        cancel() {
          log.cancelled++
        }
      })
    }
  }
  return { open, log }
}

async function readAll(stream) {
  const reader = stream.getReader()
  const parts = []
  let n = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    parts.push(value)
    n += value.length
  }
  const out = new Uint8Array(n)
  let off = 0
  for (const p of parts) {
    out.set(p, off)
    off += p.length
  }
  return out
}

async function openTrack(file, opts) {
  const src = memorySource(file, opts)
  const cursor = createByteCursor(src.open)
  const track = await loadTrack(cursor)
  return { track, layout: wavLayout(track), cursor, src }
}

/** 一口气解整段 WAV */
async function wholeWav(name, opts) {
  const { track, layout, cursor, src } = await openTrack(fixture(name), opts)
  const wav = await readAll(decodeToWav({ track, layout, cursor, start: 0, end: layout.size - 1 }))
  return { track, layout, wav, src }
}

/** 直接把裸码流喂给解码器（对照组：不经 MP4、不经 WAV） */
function decodeRaw(name) {
  const dec = createDolbyDecoder({ codec: 'ac3', stereo: true })
  const parts = [...dec.decode(fixture(name)), ...dec.flush()]
  dec.close()
  const frames = parts.reduce((n, p) => n + p.frames, 0)
  const out = new Float32Array(frames * 2)
  let off = 0
  for (const p of parts) {
    out.set(p.data, off)
    off += p.data.length
  }
  return out
}

const f32 = (bytes) => new Float32Array(bytes.slice().buffer)

/**
 * moov 在尾部、且前面隔着一大段：在 sine-5.1-ac3.mp4 的 mdat 与 moov 之间插一个 1MB 的 free 盒
 * （样本偏移都在 mdat 里，不受影响）。夹具本身的 mdat 只有 55KB，游标顺着读就跳过去了，
 * 覆盖不到「跳远了重开」那条路。
 */
function withGapBeforeMoov(gap) {
  const file = fixture('sine-5.1-ac3.mp4')
  const moovAt = file.length - 677
  const out = new Uint8Array(file.length + gap)
  out.set(file.subarray(0, moovAt))
  new DataView(out.buffer).setUint32(moovAt, gap)
  out.set([0x66, 0x72, 0x65, 0x65], moovAt + 4) // 'free'
  out.set(file.subarray(moovAt), moovAt + gap)
  return { file: out, moovAt: moovAt + gap }
}

test('样本表：两种布局都能找到 moov，时长与裸码流一致', async () => {
  for (const [name, codec] of [
    ['sine-5.1-eac3.mp4', 'ec-3'],
    ['sine-5.1-ac3.mp4', 'ac-3']
  ]) {
    const { track, layout } = await openTrack(fixture(name))
    assert.equal(track.codec, codec, name)
    assert.equal(track.sampleRate, 48000, name)
    assert.equal(track.sizes.length, 31, name)
    assert.equal(layout.frames, 31 * 1536, name)
    assert.equal(layout.size, 44 + 31 * 1536 * 8, name)
    assert.equal(sampleAtFrame(track, 0), 0)
    assert.equal(sampleAtFrame(track, 1535), 0)
    assert.equal(sampleAtFrame(track, 1536), 1)
    assert.equal(sampleAtFrame(track, layout.frames - 1), 30)
  }
})

test('moov 在尾部：跳远了在 moov 处重开，解码时再回到样本处重开', async () => {
  const { file, moovAt } = withGapBeforeMoov(1024 * 1024)
  const { track, layout, cursor, src } = await openTrack(file)
  assert.deepEqual(src.log.opens, [0, moovAt])
  const wav = await readAll(decodeToWav({ track, layout, cursor, start: 0, end: layout.size - 1 }))
  assert.deepEqual(src.log.opens, [0, moovAt, track.offsets[0]])
  assert.deepEqual(f32(wav.subarray(44)), decodeRaw('sine-5.1.ac3'))
})

test('整段：WAV 头正确，PCM 与直接解裸码流逐字节相同', async () => {
  for (const [mp4, raw] of [
    ['sine-5.1-eac3.mp4', 'sine-5.1.eac3'],
    ['sine-5.1-ac3.mp4', 'sine-5.1.ac3']
  ]) {
    const { layout, wav } = await wholeWav(mp4)
    assert.equal(wav.length, layout.size, mp4)
    const dv = new DataView(wav.buffer)
    const ascii = (at) => String.fromCharCode(...wav.subarray(at, at + 4))
    assert.equal(ascii(0), 'RIFF')
    assert.equal(dv.getUint32(4, true), layout.size - 8)
    assert.equal(ascii(8), 'WAVE')
    assert.equal(dv.getUint16(20, true), 3, 'IEEE float')
    assert.equal(dv.getUint16(22, true), 2, '立体声')
    assert.equal(dv.getUint32(24, true), 48000)
    assert.equal(dv.getUint16(32, true), 8)
    assert.equal(ascii(36), 'data')
    assert.equal(dv.getUint32(40, true), layout.size - 44)
    assert.deepEqual(f32(wav.subarray(44)), decodeRaw(raw), mp4)
  }
})

test('faststart：首播读 moov 与读音频共用一条连接', async () => {
  const { src } = await wholeWav('sine-5.1-eac3.mp4')
  assert.deepEqual(src.log.opens, [0])
})

test('上游怎么切块都不影响结果', async () => {
  const base = (await wholeWav('sine-5.1-eac3.mp4')).wav
  for (const size of [1, 7, 333, 65536 * 2]) {
    const { wav } = await wholeWav('sine-5.1-eac3.mp4', { chunk: () => size })
    assert.deepEqual(wav, base, `块大小 ${size}`)
  }
})

test('任意 Range：长度恰好兑现，内容与整段一致（seek 的前提）', async () => {
  const file = fixture('sine-5.1-eac3.mp4')
  const { layout, wav } = await wholeWav('sine-5.1-eac3.mp4')
  const { track } = await openTrack(file)
  const cases = [
    [0, 43],
    [1, 100],
    [43, 5000],
    [44, 44],
    [45, 20000],
    [44 + 1536 * 8 - 3, 44 + 1536 * 8 + 3],
    [32768, layout.size - 1], // Chromium 按 32KB 块对齐发 Range，起点不在帧边界上
    [200001, 260000],
    [layout.size - 5, layout.size - 1]
  ]
  for (const [start, end] of cases) {
    const cursor = createByteCursor(memorySource(file).open)
    const part = await readAll(decodeToWav({ track, layout, cursor, start, end }))
    assert.equal(part.length, end - start + 1, `${start}-${end}`)
    // 头两个样本内的起点从第 0 个样本解起，与整段逐字节相同；更靠后的有抖动噪声（见下一条）
    const firstFrame = Math.max(0, Math.floor((start - 44) / 8))
    if (sampleAtFrame(track, firstFrame) <= 1) {
      assert.deepEqual(part, wav.subarray(start, end + 1), `${start}-${end}`)
    }
  }
})

test('seek 后多解一帧预热：冷启动那帧的 MDCT 重叠误差被扔掉', async () => {
  const file = fixture('sine-5.1-eac3.mp4')
  const { layout, wav } = await wholeWav('sine-5.1-eac3.mp4')
  const { track } = await openTrack(file)
  const whole = f32(wav.subarray(44))
  const k = 15
  const start = 44 + track.starts[k] * 8
  const end = start + 1536 * 8 * 3 - 1
  const cursor = createByteCursor(memorySource(file).open)
  const seeked = f32(await readAll(decodeToWav({ track, layout, cursor, start, end })))
  const ref = whole.subarray(track.starts[k] * 2, track.starts[k] * 2 + seeked.length)
  const maxErr = (a, b) => a.reduce((m, v, i) => Math.max(m, Math.abs(v - b[i])), 0)

  // 对照组：不预热，直接从目标样本冷启动
  const dec = createDolbyDecoder({ codec: 'ac3', stereo: true })
  const cold = []
  for (let i = k; i < k + 4; i++) {
    for (const c of dec.decode(file.subarray(track.offsets[i], track.offsets[i] + track.sizes[i])))
      cold.push(...c.data)
  }
  dec.close()
  const coldErr = maxErr(Float32Array.from(cold.slice(0, 1536 * 2)), ref.subarray(0, 1536 * 2))
  const seekErr = maxErr(seeked, ref)
  // 零尾数的随机抖动让 seek 后不可能逐字节一致，但量级远小于冷启动误差
  assert.ok(coldErr > 1e-2, `对照组冷启动误差应明显（${coldErr}）`)
  assert.ok(seekErr < coldErr / 10, `seek 误差 ${seekErr}，冷启动 ${coldErr}`)
})

test('码流提前结束：补静音兑现 Content-Length', async () => {
  const file = fixture('sine-5.1-eac3.mp4')
  const truncateAt = file.length - 10000
  const { track, layout, cursor } = await openTrack(file, { truncateAt })
  const wav = await readAll(decodeToWav({ track, layout, cursor, start: 0, end: layout.size - 1 }))
  assert.equal(wav.length, layout.size)
  const pcm = f32(wav.subarray(44))
  assert.ok(
    pcm.subarray(pcm.length - 1536 * 2).every((v) => v === 0),
    '尾部应是静音'
  )
  assert.ok(
    pcm.subarray(0, 1536 * 20).some((v) => v !== 0),
    '前面照常有声音'
  )
})

test('上游出错：流报错，不拿静音顶替', async () => {
  const file = fixture('sine-5.1-eac3.mp4')
  const { track, layout, cursor } = await openTrack(file, { failAt: 20000 })
  const stream = decodeToWav({ track, layout, cursor, start: 0, end: layout.size - 1 })
  await assert.rejects(readAll(stream), /上游断了/)
})

test('下游取消：上游那条流被 cancel，onClose 恰好一次', async () => {
  const file = fixture('sine-5.1-eac3.mp4')
  const { track, layout, cursor, src } = await openTrack(file)
  let closes = 0
  const stream = decodeToWav({
    track,
    layout,
    cursor,
    start: 0,
    end: layout.size - 1,
    onClose: () => closes++
  })
  const reader = stream.getReader()
  await reader.read()
  await reader.read()
  await reader.cancel()
  assert.equal(src.log.cancelled, 1, '上游连接要还回去')
  assert.equal(closes, 1)
})

test('不是 MP4 / 没有杜比音轨：Mp4Error', async () => {
  const cursor = createByteCursor(memorySource(fixture('sine-5.1.eac3')).open)
  await assert.rejects(loadTrack(cursor), Mp4Error)
  assert.throws(() => parseMoov(new Uint8Array(16)), Mp4Error)
})

test('WAV 头的长度字段跟着样本表走', () => {
  const layout = { sampleRate: 44100, frames: 1000, size: 44 + 8000 }
  const dv = new DataView(wavHeader(layout).buffer)
  assert.equal(dv.getUint32(24, true), 44100)
  assert.equal(dv.getUint32(28, true), 44100 * 8)
  assert.equal(dv.getUint32(40, true), 8000)
})

// ============ AC-4 ============

const AC4_FRAME = 2048

/** 拼一个盒：4 字节长度 + 类型 + 内容 */
function box(type, ...parts) {
  const body = parts.flatMap((p) => [...p])
  const out = new Uint8Array(8 + body.length)
  new DataView(out.buffer).setUint32(0, out.length)
  out.set(
    [...type].map((c) => c.charCodeAt(0)),
    4
  )
  out.set(body, 8)
  return out
}

function u32(...values) {
  const b = new Uint8Array(values.length * 4)
  values.forEach((v, i) => new DataView(b.buffer).setUint32(i * 4, v))
  return b
}

/**
 * 最小的 AC-4 MP4：faststart，一条音轨，n 个不定长样本，每 gop 个样本一个 I 帧（stss）。
 * 样本内容给假解码器看：前 4 字节是样本序号，第 5 字节 1 = I 帧、0xff = 坏帧、0 = 普通帧。
 */
function ac4Mp4({ n = 60, gop = 8, bad = [] } = {}) {
  const payload = Array.from({ length: n }, (_, i) => {
    const b = new Uint8Array(20 + (i % 7))
    new DataView(b.buffer).setUint32(0, i)
    b[4] = bad.includes(i) ? 0xff : i % gop === 0 ? 1 : 0
    return b
  })
  const sync = Array.from({ length: Math.ceil(n / gop) }, (_, k) => k * gop + 1)
  const moovFor = (dataAt) => {
    // AudioSampleEntry：6 保留 + data_ref_index + 8 保留 + 声道 + 位深 + 4 保留 + 采样率 16.16
    const rate = u32(48000 * 65536)
    const entry = box(
      'ac-4',
      new Uint8Array(6),
      [0, 1],
      new Uint8Array(8),
      [0, 2, 0, 16],
      u32(0),
      rate
    )
    const stbl = box(
      'stbl',
      box('stsd', u32(0, 1), entry),
      box('stts', u32(0, 1, n, AC4_FRAME)),
      box('stss', u32(0, sync.length, ...sync)),
      box('stsc', u32(0, 1, 1, n, 1)),
      box('stsz', u32(0, 0, n, ...payload.map((p) => p.length))),
      box('stco', u32(0, 1, dataAt))
    )
    const mdhd = box('mdhd', u32(0, 0, 0, 48000, n * AC4_FRAME, 0))
    return box('moov', box('trak', box('mdia', mdhd, box('minf', stbl))))
  }
  const ftyp = box('ftyp', [0x4d, 0x34, 0x41, 0x20], u32(0))
  const moov = moovFor(ftyp.length + moovFor(0).length + 8)
  const mdat = box('mdat', ...payload)
  const file = new Uint8Array(ftyp.length + moov.length + mdat.length)
  file.set(ftyp)
  file.set(moov, ftyp.length)
  file.set(mdat, ftyp.length + moov.length)
  return { file, moovAt: ftyp.length, moovSize: moov.length }
}

/**
 * 模拟 AC-4 解码器的脾气：没见过 I 帧不出声；冷启动头两帧输出是乱的（-9）；坏帧不出声。
 * 好帧输出 2048 帧立体声，值都是「样本序号 + 1」，方便认位置。fed 记下收到的样本序号。
 */
function fakeAc4Decoder(fed = []) {
  let haveIframe = false
  let decoded = 0
  let closed = false
  return {
    codec: 'ac4',
    decode() {
      throw new Error('AC-4 要按帧喂')
    },
    packet(frame) {
      if (closed) throw new Error('解码器已关闭')
      const index = new DataView(frame.buffer, frame.byteOffset).getUint32(0)
      fed.push(index)
      if (frame[4] === 0xff) {
        haveIframe = false
        return []
      }
      if (frame[4] === 1) haveIframe = true
      if (!haveIframe) return []
      const value = decoded++ < 2 ? -9 : index + 1
      const data = new Float32Array(AC4_FRAME * 2).fill(value)
      return [{ channels: 2, sampleRate: 48000, frames: AC4_FRAME, data }]
    },
    flush: () => [],
    reset() {
      haveIframe = false
      decoded = 0
    },
    errors: 0,
    close() {
      closed = true
    }
  }
}

async function ac4Wav(file, start, sourceOpts) {
  const fed = []
  const cursor = createByteCursor(memorySource(file, sourceOpts).open)
  const track = await loadTrack(cursor)
  const layout = wavLayout(track)
  const stream = decodeToWav({
    track,
    layout,
    cursor,
    start,
    end: layout.size - 1,
    createDecoder: () => fakeAc4Decoder(fed)
  })
  return { track, layout, wav: await readAll(stream), fed }
}

/** WAV 字节区间里每个完整 PCM 帧的左声道值；firstFrame 是第一个完整帧在文件里的帧序号 */
function frameValues(bytes, start) {
  const lead = start < 44 ? 44 - start : (8 - ((start - 44) % 8)) % 8
  const n = Math.floor((bytes.length - lead) / 8)
  const f = new Float32Array(bytes.slice(lead, lead + n * 8).buffer)
  const values = Array.from({ length: n }, (_, i) => f[i * 2])
  return { values, firstFrame: start < 44 ? 0 : Math.ceil((start - 44) / 8) }
}

test('AC-4 样本表：ac-4 样本描述、不定长样本、stss 的 I 帧', () => {
  const { file, moovAt, moovSize } = ac4Mp4({ n: 20, gop: 8 })
  const track = parseMoov(file.subarray(moovAt, moovAt + moovSize))
  assert.equal(track.codec, 'ac-4')
  assert.equal(track.sampleRate, 48000)
  assert.equal(track.sizes.length, 20)
  assert.equal(track.sizes[3], 23)
  assert.equal(track.starts[20], 20 * AC4_FRAME)
  assert.deepEqual([...track.sync], [0, 8, 16])
  assert.equal(syncAtOrBefore(track, 7), 0)
  assert.equal(syncAtOrBefore(track, 8), 8)
  assert.equal(syncAtOrBefore(track, 19), 16)
})

test('AC-4 整段：一包一帧按样本落在时间轴上，跨块的样本拼齐了再送', async () => {
  const n = 60
  // 块小到一个样本经常被切成两三段
  const { wav, layout, fed } = await ac4Wav(ac4Mp4({ n }).file, 0, { chunk: () => 9 })
  assert.equal(wav.length, layout.size)
  assert.deepEqual(
    fed,
    Array.from({ length: n }, (_, i) => i),
    '每个样本整包送一次'
  )
  const { values } = frameValues(wav, 0)
  // 从头播放：冷启动头两帧本来就是这样（从头解的时间轴上也是它），之后每帧 = 样本序号 + 1
  for (let i = 2; i < n; i++) assert.equal(values[i * AC4_FRAME + 5], i + 1, `样本 ${i}`)
})

test('AC-4 seek：退到至少提前 2 帧的 I 帧起解，目标处没有冷启动的乱帧', async () => {
  const { file } = ac4Mp4({ n: 60, gop: 8 })
  // 目标样本：恰好是 I 帧、I 帧后第 1 / 第 2 帧、GOP 中间、最后一个
  for (const k of [16, 17, 18, 29, 59]) {
    const start = 44 + k * AC4_FRAME * 8 + 12 // 故意不落在帧边界上
    const { wav, fed, track } = await ac4Wav(file, start)
    assert.equal(fed[0], syncAtOrBefore(track, Math.max(0, k - 2)), `目标 ${k} 的起解样本`)
    const { values, firstFrame } = frameValues(wav, start)
    values.forEach((v, i) => {
      const expected = Math.floor((firstFrame + i) / AC4_FRAME) + 1
      if (v !== expected) assert.fail(`目标 ${k}：第 ${firstFrame + i} 帧是 ${v}，应为 ${expected}`)
    })
  }
})

test('AC-4 坏帧：那一帧起补静音直到下一个 I 帧，后面的不错位', async () => {
  const n = 40
  const { wav } = await ac4Wav(ac4Mp4({ n, gop: 8, bad: [20] }).file, 0)
  assert.equal(wav.length, 44 + n * AC4_FRAME * 8)
  const { values } = frameValues(wav, 0)
  const at = (i) => values[i * AC4_FRAME + 100]
  assert.equal(at(19), 20)
  for (const i of [20, 21, 22, 23]) assert.equal(at(i), 0, `样本 ${i} 应是静音`)
  for (const i of [24, 30, 39]) assert.equal(at(i), i + 1, `样本 ${i}`)
})
