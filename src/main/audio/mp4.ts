/**
 * MP4（ISO BMFF）里杜比音轨（AC-3 / E-AC-3 / AC-4）的样本表——只为杜比软解（audio/dolbyStream.ts）
 * 服务，够用即止。
 *
 * 两家的杜比全景声实测都是 faststart 布局（ftyp → moov → mdat）、单条音轨：
 * - QQ（D001*.mp4 / 加密版 D0M1*.mmp4）：ec-3，每样本 1536 帧，定长 1792 字节（448kbps），没有 stss；
 * - 网易：ac-4（IMS），每样本 2048 帧、不定长（256kbps），stss 标出每 24 帧一个 I 帧。
 * 这里仍按规范完整展开 stsz / stsc / stco(co64) / stts / stss，不依赖「定长、连续」这些巧合；
 * 只有分片 MP4（moof）不支持。
 *
 * 纯函数、不 import electron，tools/dolbyStream.test.mjs 直接跑。
 */

export type DolbySampleEntry = 'ac-3' | 'ec-3' | 'ac-4'

const DOLBY_ENTRIES: readonly string[] = ['ac-3', 'ec-3', 'ac-4']

export interface Mp4AudioTrack {
  codec: DolbySampleEntry
  /** 输出采样率（取样本描述里的，mdhd 的 timescale 不一定等于它） */
  sampleRate: number
  /** 各样本在文件中的起始偏移 */
  offsets: Float64Array
  sizes: Uint32Array
  /** 各样本首帧的 PCM 帧序号（按 sampleRate 折算）；长度 = 样本数 + 1，末项即总帧数 */
  starts: Float64Array
  /**
   * 同步样本（可以从它开始解的帧，AC-4 的 I 帧）的序号，升序；null = 没有 stss，按规范每个样本都是。
   * AC-3 系每帧都能独立起解，不看它。
   */
  sync: Uint32Array | null
}

export class Mp4Error extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'Mp4Error'
  }
}

interface Box {
  type: string
  /** 内容（不含盒头）的起止，相对传入的 buf */
  start: number
  end: number
}

function* boxes(buf: Uint8Array, from: number, to: number): Generator<Box> {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  let pos = from
  while (pos + 8 <= to) {
    let size = dv.getUint32(pos)
    const type = String.fromCharCode(buf[pos + 4], buf[pos + 5], buf[pos + 6], buf[pos + 7])
    let header = 8
    if (size === 1) {
      if (pos + 16 > to) throw new Mp4Error(`${type} 盒头不完整`)
      size = Number(dv.getBigUint64(pos + 8))
      header = 16
    } else if (size === 0) {
      size = to - pos
    }
    if (size < header || pos + size > to) throw new Mp4Error(`${type} 盒长度越界`)
    yield { type, start: pos + header, end: pos + size }
    pos += size
  }
}

function child(buf: Uint8Array, parent: Box, type: string): Box | null {
  for (const b of boxes(buf, parent.start, parent.end)) if (b.type === type) return b
  return null
}

function need(buf: Uint8Array, parent: Box, type: string): Box {
  const b = child(buf, parent, type)
  if (!b) throw new Mp4Error(`缺少 ${type}`)
  return b
}

/** 音轨的编码与采样率：stsd 第一个样本描述（AudioSampleEntry） */
function sampleEntry(buf: Uint8Array, stsd: Box): { codec: string; sampleRate: number } | null {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  // FullBox(4) + entry_count(4)，随后是第一个样本描述盒
  const first = boxes(buf, stsd.start + 8, stsd.end).next()
  if (first.done) return null
  const entry = first.value
  // SampleEntry 6 保留 + 2 data_ref_index，AudioSampleEntry 8 保留 + 声道 2 + 位深 2 + 4 + 采样率 16.16
  if (entry.end - entry.start < 28) return null
  const sampleRate = dv.getUint32(entry.start + 24) >>> 16
  return { codec: entry.type, sampleRate }
}

/**
 * 从完整的 moov 盒（含盒头）里取出第一条杜比音轨的样本表。
 * @throws Mp4Error 没有这类音轨、或样本表残缺
 */
export function parseMoov(moov: Uint8Array): Mp4AudioTrack {
  const top = boxes(moov, 0, moov.length).next()
  if (top.done || top.value.type !== 'moov') throw new Mp4Error('不是 moov 盒')
  const dv = new DataView(moov.buffer, moov.byteOffset, moov.byteLength)
  const u32 = (at: number): number => dv.getUint32(at)

  for (const trak of boxes(moov, top.value.start, top.value.end)) {
    if (trak.type !== 'trak') continue
    const mdia = child(moov, trak, 'mdia')
    const minf = mdia && child(moov, mdia, 'minf')
    const stbl = minf && child(moov, minf, 'stbl')
    if (!mdia || !stbl) continue
    const stsd = child(moov, stbl, 'stsd')
    const entry = stsd && sampleEntry(moov, stsd)
    if (!entry || !DOLBY_ENTRIES.includes(entry.codec)) continue

    const mdhd = need(moov, mdia, 'mdhd')
    const timescale = moov[mdhd.start] === 1 ? u32(mdhd.start + 20) : u32(mdhd.start + 12)
    const sampleRate = entry.sampleRate || timescale
    if (!timescale || !sampleRate) throw new Mp4Error('采样率为 0')

    // stsz：定长或逐样本
    const stsz = need(moov, stbl, 'stsz')
    const fixed = u32(stsz.start + 4)
    const count = u32(stsz.start + 8)
    const sizes = new Uint32Array(count)
    if (fixed) sizes.fill(fixed)
    else {
      if (stsz.start + 12 + count * 4 > stsz.end) throw new Mp4Error('stsz 残缺')
      for (let i = 0; i < count; i++) sizes[i] = u32(stsz.start + 12 + i * 4)
    }

    // stco / co64：各 chunk 的起始偏移
    const co64 = child(moov, stbl, 'co64')
    const stco = co64 ?? need(moov, stbl, 'stco')
    const chunkCount = u32(stco.start + 4)
    const width = co64 ? 8 : 4
    if (stco.start + 8 + chunkCount * width > stco.end) throw new Mp4Error('stco 残缺')
    const chunkOffset = (i: number): number =>
      co64 ? Number(dv.getBigUint64(stco.start + 8 + i * 8)) : u32(stco.start + 8 + i * 4)

    // stsc：(first_chunk, samples_per_chunk) 游程，展开成逐样本偏移
    const stsc = need(moov, stbl, 'stsc')
    const runs = u32(stsc.start + 4)
    if (stsc.start + 8 + runs * 12 > stsc.end) throw new Mp4Error('stsc 残缺')
    const offsets = new Float64Array(count)
    let sample = 0
    for (let r = 0; r < runs && sample < count; r++) {
      const firstChunk = u32(stsc.start + 8 + r * 12) - 1
      const perChunk = u32(stsc.start + 12 + r * 12)
      const nextFirst = r + 1 < runs ? u32(stsc.start + 8 + (r + 1) * 12) - 1 : chunkCount
      for (let c = firstChunk; c < nextFirst && sample < count; c++) {
        let off = chunkOffset(c)
        for (let k = 0; k < perChunk && sample < count; k++) {
          offsets[sample] = off
          off += sizes[sample++]
        }
      }
    }
    if (sample < count) throw new Mp4Error('stsc 覆盖不到全部样本')

    // stts：(sample_count, delta) 游程，折算成输出采样率下的 PCM 帧序号
    const stts = need(moov, stbl, 'stts')
    const sttsRuns = u32(stts.start + 4)
    if (stts.start + 8 + sttsRuns * 8 > stts.end) throw new Mp4Error('stts 残缺')
    const starts = new Float64Array(count + 1)
    let t = 0
    sample = 0
    for (let r = 0; r < sttsRuns && sample < count; r++) {
      const n = u32(stts.start + 8 + r * 8)
      const delta = u32(stts.start + 12 + r * 8)
      for (let k = 0; k < n && sample < count; k++) {
        starts[sample++] = Math.round((t * sampleRate) / timescale)
        t += delta
      }
    }
    if (sample < count) throw new Mp4Error('stts 覆盖不到全部样本')
    starts[count] = Math.round((t * sampleRate) / timescale)

    // stss：同步样本表（1 起），可缺
    let sync: Uint32Array | null = null
    const stss = child(moov, stbl, 'stss')
    if (stss) {
      const n = u32(stss.start + 4)
      if (stss.start + 8 + n * 4 > stss.end) throw new Mp4Error('stss 残缺')
      sync = new Uint32Array(n)
      for (let i = 0; i < n; i++) sync[i] = u32(stss.start + 8 + i * 4) - 1
      if (!n || sync[0] !== 0) throw new Mp4Error('第一个样本不是同步样本')
    }

    return {
      codec: entry.codec as DolbySampleEntry,
      sampleRate,
      offsets,
      sizes,
      starts,
      sync
    }
  }
  throw new Mp4Error('没有杜比音轨')
}

/** 不晚于 sample 的最近一个同步样本；没有 stss 时就是它自己 */
export function syncAtOrBefore(track: Mp4AudioTrack, sample: number): number {
  const sync = track.sync
  if (!sync) return sample
  let lo = 0
  let hi = sync.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1
    if (sync[mid] <= sample) lo = mid
    else hi = mid - 1
  }
  return sync[lo]
}

/** 含 frame 这一 PCM 帧的样本序号（二分）；越界夹到首尾 */
export function sampleAtFrame(track: Mp4AudioTrack, frame: number): number {
  const n = track.sizes.length
  let lo = 0
  let hi = n - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1
    if (track.starts[mid] <= frame) lo = mid
    else hi = mid - 1
  }
  return Math.max(0, lo)
}
