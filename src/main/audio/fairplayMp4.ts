import type { TemariTemplate } from './temari'

export interface AppleSegment {
  uri: string
  start: number
  end: number
  keyUri: string
}

export interface ApplePlaylist {
  fileUrl: string
  segments: AppleSegment[]
}

export interface Box {
  type: string
  start: number
  end: number
  header: number
  body: number
}

interface Sample {
  offset: number
  size: number
  duration: number
}

export interface Subsample {
  clear: number
  protected: number
}

interface TrunInfo {
  box: Box
  dataOffset: number
  samples: Sample[]
}

interface TrafInfo {
  trackId: number
  baseDataOffset: number | null
  defaultSampleSize: number
  defaultSampleDuration: number
  truns: TrunInfo[]
  subsamples: Subsample[][]
}

/** moov/mvex/trex 里的默认样本参数：trun 没给时按它算（Apple 的 alac 分片全靠它） */
export interface TrexInfo {
  defaultSampleSize: number
  defaultSampleDuration: number
}

export type TrexTable = Map<number, TrexInfo>

export function readTrexTable(data: Uint8Array, moov: Box): TrexTable {
  const table: TrexTable = new Map()
  for (const trex of findAll(data, moov, 'trex')) {
    table.set(u32(data, trex.body + 4), {
      defaultSampleDuration: u32(data, trex.body + 12),
      defaultSampleSize: u32(data, trex.body + 16)
    })
  }
  return table
}

const CONTAINERS = new Set([
  'moov',
  'trak',
  'mdia',
  'minf',
  'stbl',
  'edts',
  'dinf',
  'mvex',
  'sinf',
  'schi'
])
const ENCRYPTION_BOXES = new Set(['saiz', 'saio', 'senc'])
const PIFF_SENC = 'a2394f525a9b4f14a2446c427c648df4'

export function box(data: Uint8Array, start: number, limit = data.length): Box {
  if (start + 8 > limit) throw new Error('MP4 盒头不完整')
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength)
  let size = dv.getUint32(start)
  let header = 8
  const type = String.fromCharCode(
    data[start + 4],
    data[start + 5],
    data[start + 6],
    data[start + 7]
  )
  if (size === 1) {
    if (start + 16 > limit) throw new Error(`${type} 扩展盒头不完整`)
    size = Number(dv.getBigUint64(start + 8))
    header = 16
  } else if (size === 0) {
    size = limit - start
  }
  if (size < header || start + size > limit) throw new Error(`${type} 盒长度越界`)
  return { type, start, end: start + size, header, body: start + header }
}

export function* children(data: Uint8Array, parent: Box, from = parent.body): Generator<Box> {
  let pos = from
  while (pos + 8 <= parent.end) {
    const child = box(data, pos, parent.end)
    yield child
    pos = child.end
  }
}

export function findAll(data: Uint8Array, parent: Box, type: string, from = parent.body): Box[] {
  const result: Box[] = []
  for (const child of children(data, parent, from)) {
    if (child.type === type) result.push(child)
    if (CONTAINERS.has(child.type) || child.type === 'stsd' || child.type === 'enca') {
      const nestedFrom =
        child.type === 'stsd'
          ? child.body + 8
          : child.type === 'enca'
            ? child.body + 28
            : child.body
      result.push(...findAll(data, child, type, nestedFrom))
    }
  }
  return result
}

export function makeBox(type: string, ...parts: Uint8Array[]): Uint8Array {
  const size = 8 + parts.reduce((sum, part) => sum + part.length, 0)
  const output = new Uint8Array(size)
  new DataView(output.buffer).setUint32(0, size)
  for (let i = 0; i < 4; i++) output[4 + i] = type.charCodeAt(i)
  let offset = 8
  for (const part of parts) {
    output.set(part, offset)
    offset += part.length
  }
  return output
}

export function raw(data: Uint8Array, start: number, end: number): Uint8Array {
  return data.subarray(start, end)
}

export function u32(data: Uint8Array, at: number): number {
  return new DataView(data.buffer, data.byteOffset + at, 4).getUint32(0)
}

export function i32(data: Uint8Array, at: number): number {
  return new DataView(data.buffer, data.byteOffset + at, 4).getInt32(0)
}

export function big64(data: Uint8Array, at: number): number {
  return Number(new DataView(data.buffer, data.byteOffset + at, 8).getBigUint64(0))
}

function flags(data: Uint8Array, at: number): number {
  return u32(data, at) & 0xffffff
}

function groupingType(data: Uint8Array, at: number): string {
  return String.fromCharCode(data[at + 4], data[at + 5], data[at + 6], data[at + 7])
}

export function transformInit(data: Uint8Array, parent: Box): Uint8Array {
  if (parent.type === 'pssh') return new Uint8Array()
  if (
    (parent.type === 'sbgp' || parent.type === 'sgpd') &&
    ['seam', 'seig'].includes(groupingType(data, parent.body))
  ) {
    return new Uint8Array()
  }
  if (parent.type === 'enca') {
    let format = 'mp4a'
    const body: Uint8Array[] = []
    for (const child of children(data, parent, parent.body + 28)) {
      if (child.type === 'sinf') {
        const frma = findAll(data, child, 'frma')[0]
        if (frma) {
          format = String.fromCharCode(
            data[frma.body],
            data[frma.body + 1],
            data[frma.body + 2],
            data[frma.body + 3]
          )
        }
        continue
      }
      body.push(transformInit(data, child))
    }
    return makeBox(format, raw(data, parent.body, parent.body + 28), ...body)
  }
  if (parent.type === 'stsd') {
    // 条目数必须原样保留。Apple 把「中途换密钥」表达成新的样本描述：stsd 里两条
    // enca（各自的 tenc 带不同 KID 与常量 IV），第二条起的分片在 tfhd 里写
    // sample_description_index=2。只留第一条并把 count 改写成 1 的话，FFmpeg 会把
    // 后续分片当成索引越界、静默停在第一段——整首歌只剩 14.9 秒（实测 45MB 只出来
    // 2.9MB）。逐条转成明文格式、保留条目数，索引就仍然指得到。
    const entries = [...children(data, parent, parent.body + 8)]
    if (entries.length === 0) throw new Error('stsd 没有样本描述')
    const header = new Uint8Array(8)
    header.set(raw(data, parent.body, parent.body + 4), 0)
    new DataView(header.buffer).setUint32(4, entries.length)
    return makeBox('stsd', header, ...entries.map((entry) => transformInit(data, entry)))
  }
  if (CONTAINERS.has(parent.type)) {
    const body = [...children(data, parent)].map((child) => transformInit(data, child))
    return makeBox(parent.type, ...body)
  }
  return raw(data, parent.start, parent.end)
}

export function parseApplePlaylist(playlistUrl: string, text: string): ApplePlaylist {
  const lines = text.split(/\r?\n/)
  const segments: AppleSegment[] = []
  let keyUri = ''
  let pending: { uri: string; length: number; offset?: number } | null = null
  let nextOffset = 0
  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (line.startsWith('#EXT-X-KEY:')) {
      const uri = /URI="([^"]+)"/.exec(line)?.[1]
      if (/KEYFORMAT="com\.apple\.streamingkeydelivery"/.test(line) && uri) keyUri = uri
      continue
    }
    if (line.startsWith('#EXT-X-BYTERANGE:')) {
      const value = line.slice('#EXT-X-BYTERANGE:'.length)
      const [length, offset] = value.split('@')
      pending = {
        uri: '',
        length: Number(length),
        offset: offset == null ? undefined : Number(offset)
      }
      continue
    }
    if (!line || line.startsWith('#')) continue
    if (pending) {
      const start = pending.offset ?? nextOffset
      const end = start + pending.length - 1
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || pending.length <= 0) {
        throw new Error('HLS 分片字节范围无效')
      }
      segments.push({ uri: new URL(line, playlistUrl).toString(), start, end, keyUri })
      nextOffset = end + 1
      pending = null
    }
  }
  if (!segments.length) throw new Error('HLS 没有可用的字节分片')
  const fileUrl = segments[0].uri
  if (segments.some((segment) => segment.uri !== fileUrl)) {
    throw new Error('暂不支持多个独立音频文件组成的 HLS')
  }
  return { fileUrl, segments }
}

function parseSenc(
  data: Uint8Array,
  boxInfo: Box,
  sampleCount: number,
  ivSize: number
): Subsample[][] {
  const isUuid = boxInfo.type === 'uuid'
  const at = boxInfo.body + (isUuid ? 16 : 0)
  const boxFlags = flags(data, at)
  const count = u32(data, at + 4)
  if (count !== sampleCount) throw new Error('senc 与 trun 样本数不一致')
  if ((boxFlags & 2) === 0) return Array.from({ length: sampleCount }, () => [])
  const bytes = data.subarray(at + 8, boxInfo.end)
  const candidates = [...new Set([ivSize, 0, 8, 16])]
  for (const candidate of candidates) {
    let offset = 0
    const result: Subsample[][] = []
    let valid = true
    for (let i = 0; i < sampleCount && valid; i++) {
      offset += candidate
      if (offset + 2 > bytes.length) break
      const count = new DataView(bytes.buffer, bytes.byteOffset + offset, 2).getUint16(0)
      offset += 2
      const patterns: Subsample[] = []
      for (let j = 0; j < count; j++) {
        if (offset + 6 > bytes.length) {
          valid = false
          break
        }
        const dv = new DataView(bytes.buffer, bytes.byteOffset + offset, 6)
        patterns.push({ clear: dv.getUint16(0), protected: dv.getUint32(2) })
        offset += 6
      }
      result.push(patterns)
    }
    if (valid && offset === bytes.length && result.length === sampleCount) return result
  }
  throw new Error('senc 子样本信息解析失败')
}

function parseTraf(data: Uint8Array, traf: Box, trex: TrexTable, ivSize: number): TrafInfo {
  let trackId = 0
  let baseDataOffset: number | null = null
  let defaultSampleSize = 0
  let defaultSampleDuration = 0
  const truns: TrunInfo[] = []
  let senc: Box | null = null
  for (const child of children(data, traf)) {
    if (child.type === 'tfhd') {
      const tfhdFlags = flags(data, child.body)
      trackId = u32(data, child.body + 4)
      let at = child.body + 8
      if (tfhdFlags & 1) {
        baseDataOffset = Number(big64(data, at))
        at += 8
      }
      if (tfhdFlags & 2) at += 4
      if (tfhdFlags & 8) {
        defaultSampleDuration = u32(data, at)
        at += 4
      }
      if (tfhdFlags & 16) {
        defaultSampleSize = u32(data, at)
      }
    } else if (child.type === 'trun') {
      const trunFlags = flags(data, child.body)
      const count = u32(data, child.body + 4)
      let at = child.body + 8
      const dataOffset = trunFlags & 1 ? i32(data, at) : 0
      if (trunFlags & 1) at += 4
      if (trunFlags & 4) at += 4
      const samples: Sample[] = []
      for (let i = 0; i < count; i++) {
        let duration = 0
        let size = 0
        if (trunFlags & 0x100) {
          duration = u32(data, at)
          at += 4
        }
        if (trunFlags & 0x200) {
          size = u32(data, at)
          at += 4
        }
        if (trunFlags & 0x400) at += 4
        if (trunFlags & 0x800) at += 4
        samples.push({ offset: 0, size, duration })
      }
      truns.push({ box: child, dataOffset, samples })
    } else if (child.type === 'senc') {
      senc = child
    } else if (child.type === 'uuid') {
      const uuid = [...data.subarray(child.body, child.body + 16)]
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
      if (uuid === PIFF_SENC) senc = child
    }
  }
  const defaults = trex.get(trackId)
  if (!defaultSampleSize) defaultSampleSize = defaults?.defaultSampleSize ?? 0
  if (!defaultSampleDuration) defaultSampleDuration = defaults?.defaultSampleDuration ?? 0
  for (const trun of truns) {
    for (const sample of trun.samples) {
      if (sample.size === 0) sample.size = defaultSampleSize
      if (sample.duration === 0) sample.duration = defaultSampleDuration
    }
  }
  for (let i = 0; i < truns.length; i++) {
    const trun = truns[i]
    if (!trun.samples.every((sample) => sample.size > 0) && i + 1 < truns.length) {
      const next = truns[i + 1]
      const size = (next.dataOffset - trun.dataOffset) / trun.samples.length
      for (const sample of trun.samples) sample.size = size
    }
  }
  const sampleCount = truns.reduce((sum, trun) => sum + trun.samples.length, 0)
  const subsamples = senc
    ? parseSenc(data, senc, sampleCount, ivSize)
    : Array.from({ length: sampleCount }, () => [])
  return {
    trackId,
    baseDataOffset,
    defaultSampleSize,
    defaultSampleDuration,
    truns,
    subsamples
  }
}

function decryptFragment(
  data: Uint8Array,
  moof: Box,
  mdat: Box,
  template: TemariTemplate,
  trex: TrexTable,
  ivSize: number
): Uint8Array[] {
  const mdatData = new Uint8Array(raw(data, mdat.body, mdat.end))
  const trafs = [...children(data, moof)].filter((child) => child.type === 'traf')
  for (const traf of trafs) {
    const info = parseTraf(data, traf, trex, ivSize)
    if (info.truns.length === 0) continue
    let sampleIndex = 0
    for (let runIndex = 0; runIndex < info.truns.length; runIndex++) {
      const trun = info.truns[runIndex]
      const base = (info.baseDataOffset ?? moof.start) + trun.dataOffset
      let offset = base - mdat.body
      if (offset < 0 || offset > mdatData.length) throw new Error('trun 数据偏移越界')
      for (const sample of trun.samples) {
        if (
          !Number.isInteger(sample.size) ||
          sample.size <= 0 ||
          offset + sample.size > mdatData.length
        ) {
          throw new Error('MP4 样本大小无效')
        }
        const encrypted = mdatData.subarray(offset, offset + sample.size)
        const patterns = info.subsamples[sampleIndex] ?? []
        if (patterns.length === 0) {
          mdatData.set(template.decrypt(encrypted), offset)
        } else {
          let cursor = 0
          for (const pattern of patterns) {
            cursor += pattern.clear
            const end = cursor + pattern.protected
            if (end > encrypted.length) throw new Error('子样本范围越界')
            mdatData.set(template.decrypt(encrypted.subarray(cursor, end)), offset + cursor)
            cursor = end
          }
        }
        offset += sample.size
        sampleIndex++
      }
    }
  }

  let removed = 0
  const rewrite = (parent: Box): Uint8Array[] => {
    const parts: Uint8Array[] = []
    for (const child of children(data, parent)) {
      if (ENCRYPTION_BOXES.has(child.type) || child.type === 'pssh') {
        removed += child.end - child.start
        continue
      }
      if (child.type === 'uuid') {
        const uuid = [...data.subarray(child.body, child.body + 16)]
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('')
        if (uuid === PIFF_SENC) {
          removed += child.end - child.start
          continue
        }
      }
      if (
        (child.type === 'sbgp' || child.type === 'sgpd') &&
        ['seam', 'seig'].includes(groupingType(data, child.body))
      ) {
        removed += child.end - child.start
        continue
      }
      if (child.type === 'traf') parts.push(makeBox('traf', ...rewrite(child)))
      else parts.push(raw(data, child.start, child.end))
    }
    return parts
  }
  const newMoof = makeBox('moof', ...rewrite(moof))
  for (const child of children(newMoof, box(newMoof, 0))) {
    if (child.type !== 'traf') continue
    for (const trun of children(newMoof, child)) {
      if (trun.type !== 'trun' || (flags(newMoof, trun.body) & 1) === 0) continue
      const at = trun.body + 8
      new DataView(newMoof.buffer).setInt32(at, i32(newMoof, at) - removed)
    }
  }
  return [newMoof, makeBox('mdat', mdatData)]
}

export function decryptAppleMp4(
  encrypted: Uint8Array,
  segments: AppleSegment[],
  templateFor: (keyUri: string) => TemariTemplate
): Uint8Array {
  const outputs: Uint8Array[] = []
  let pos = 0
  let fragment = 0
  let moov: Box | null = null
  while (pos < encrypted.length) {
    const current = box(encrypted, pos)
    if (current.type === 'ftyp') {
      outputs.push(raw(encrypted, current.start, current.end))
    } else if (current.type === 'moov') {
      moov = current
      outputs.push(transformInit(encrypted, current))
    } else if (current.type === 'moof') {
      const extras: Uint8Array[] = []
      let next = box(encrypted, current.end)
      while (next.type === 'emsg' || next.type === 'prft') {
        extras.push(raw(encrypted, next.start, next.end))
        next = box(encrypted, next.end)
      }
      if (next.type !== 'mdat') throw new Error('moof 后缺少 mdat')
      const segment = segments[fragment]
      if (!segment) throw new Error('HLS 分片数与 MP4 分片数不一致')
      if (!segment.keyUri) throw new Error(`第 ${fragment + 1} 个分片缺少密钥 URI`)
      const trex: TrexTable = moov ? readTrexTable(encrypted, moov) : new Map()
      let ivSize = 0
      if (moov) {
        const tenc = findAll(encrypted, moov, 'tenc')[0]
        if (tenc) {
          const version = encrypted[tenc.body]
          if (version > 0 && (encrypted[tenc.body + 5] & 15) !== 0) {
            throw new Error('暂不支持跳块加密的 Apple Music 码流')
          }
          ivSize = encrypted[tenc.body + 7]
        }
      }
      const decrypted = decryptFragment(
        encrypted,
        current,
        next,
        templateFor(segment.keyUri),
        trex,
        ivSize
      )
      outputs.push(decrypted[0], ...extras, decrypted[1])
      fragment++
      pos = next.end
      continue
    } else if (current.type !== 'sidx') {
      outputs.push(raw(encrypted, current.start, current.end))
    }
    pos = current.end
  }
  if (fragment !== segments.length) throw new Error('HLS 与 MP4 的分片数量不一致')
  const length = outputs.reduce((sum, part) => sum + part.length, 0)
  const output = new Uint8Array(length)
  let offset = 0
  for (const part of outputs) {
    output.set(part, offset)
    offset += part.length
  }
  return output
}

// ============ 流式播放：单个分片的索引与解密 ============

export interface AppleFragmentSample {
  /** 样本起点，相对传入的 data */
  offset: number
  size: number
  /** 样本时长（轨道时基）；trun / tfhd / trex 都没给时为 0 */
  duration: number
}

export interface AppleFragmentInfo {
  trackId: number
  moofStart: number
  /** 密文样本区（mdat 载荷）在 data 里的起止 */
  payloadStart: number
  payloadSize: number
  samples: AppleFragmentSample[]
  subsamples: Subsample[][]
}

/**
 * 只读盒头：允许盒体被缓冲区截断。流式播放量分片样本表时，窗口里往往只有 moof 与 mdat 的头，
 * 而 mdat 有 2.9MB——按完整盒校验会直接判失败。样本字节是否越界由 decryptAppleSamples 另校验。
 */
function boxHeader(data: Uint8Array, start: number): Box {
  if (start + 8 > data.length) throw new Error('MP4 盒头不完整')
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength)
  let size = dv.getUint32(start)
  let header = 8
  const type = String.fromCharCode(
    data[start + 4],
    data[start + 5],
    data[start + 6],
    data[start + 7]
  )
  if (size === 1) {
    if (start + 16 > data.length) throw new Error(`${type} 扩展盒头不完整`)
    size = Number(dv.getBigUint64(start + 8))
    header = 16
  } else if (size === 0) {
    size = data.length - start
  }
  if (size < header) throw new Error(`${type} 盒长度越界`)
  return { type, start, end: start + size, header, body: start + header }
}

/**
 * 量出一个 HLS 分片的样本表（大小与时长）。流式播放靠它对每段建索引，再合成扁平
 * moov——与整首解密共用同一套 tfhd / trun / senc 解析。
 *
 * @param data 以该分片起点开始的密文（`moof` 在其中的位置由 `moof.start` 给出）
 * @param base data[0] 在远端文件里的绝对偏移；tfhd 带 base_data_offset（绝对偏移）时用来换算
 */
export function parseAppleFragment(
  data: Uint8Array,
  moof: Box,
  trex: TrexTable,
  ivSize: number,
  base: number
): AppleFragmentInfo {
  let at = moof.end
  let next = boxHeader(data, at)
  while (next.type === 'emsg' || next.type === 'prft') {
    at = next.end
    next = boxHeader(data, at)
  }
  if (next.type !== 'mdat') throw new Error('moof 后缺少 mdat')
  const samples: AppleFragmentSample[] = []
  const subsamples: Subsample[][] = []
  let trackId = 0
  for (const traf of children(data, moof)) {
    if (traf.type !== 'traf') continue
    const info = parseTraf(data, traf, trex, ivSize)
    if (!info.truns.length) continue
    trackId = info.trackId
    let index = 0
    for (const trun of info.truns) {
      const origin = info.baseDataOffset ?? base + moof.start
      let offset = origin + trun.dataOffset - base
      for (const sample of trun.samples) {
        samples.push({ offset, size: sample.size, duration: sample.duration })
        subsamples.push(info.subsamples[index++] ?? [])
        offset += sample.size
      }
    }
  }
  return {
    trackId,
    moofStart: moof.start,
    payloadStart: next.body,
    payloadSize: next.end - next.body,
    samples,
    subsamples
  }
}

/**
 * 把一个分片解成「按样本顺序首尾相接的明文」。
 *
 * 与上面的 decryptFragment 分工不同：那条路要重建 moof（整首重封装用），这里只要样本
 * 字节，样本表由流式播放自己合成，所以不改写任何盒、也不复制 moof。
 */
export function decryptAppleSamples(
  data: Uint8Array,
  info: AppleFragmentInfo,
  template: TemariTemplate
): Uint8Array {
  let total = 0
  for (const sample of info.samples) total += sample.size
  const output = new Uint8Array(total)
  let at = 0
  for (let i = 0; i < info.samples.length; i++) {
    const sample = info.samples[i]
    const cipher = data.subarray(sample.offset, sample.offset + sample.size)
    if (cipher.length !== sample.size) throw new Error('MP4 样本越界')
    const patterns = info.subsamples[i]
    if (!patterns || patterns.length === 0) {
      output.set(template.decrypt(cipher), at)
    } else {
      // 子样本：clear 段原样搬，protected 段解密（与 decryptFragment 的原地版本等价）
      let cursor = 0
      for (const pattern of patterns) {
        const clearEnd = cursor + pattern.clear
        const end = clearEnd + pattern.protected
        if (end > cipher.length) throw new Error('子样本范围越界')
        if (clearEnd > cursor) output.set(cipher.subarray(cursor, clearEnd), at + cursor)
        output.set(template.decrypt(cipher.subarray(clearEnd, end)), at + clearEnd)
        cursor = end
      }
      if (cursor < cipher.length) output.set(cipher.subarray(cursor), at + cursor)
    }
    at += sample.size
  }
  return output
}
