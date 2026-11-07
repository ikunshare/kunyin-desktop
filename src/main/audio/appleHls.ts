import { randomBytes } from 'node:crypto'
import { mkdir, open as openFile, rm } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import { join } from 'node:path'
import { storeAppleAudio } from '../cache/appleCache'
import { createLogger } from '../core/logger'
import { DATA_CACHE_SUBDIR, appDataPath } from '../core/paths'
import { drainResponse, requestRaw, requestText } from '../net/request'
import { getSettings } from '../store/settings'
import { createAppleTemplates } from './appleMusic'
import type { AppleAudioSpec } from './appleMusic'
import {
  box,
  children,
  decryptAppleSamples,
  findAll,
  makeBox,
  parseAppleFragment,
  parseApplePlaylist,
  raw,
  readTrexTable,
  transformInit,
  u32
} from './fairplayMp4'
import type { AppleFragmentInfo, AppleSegment, Box, TrexTable } from './fairplayMp4'
import type { TemariTemplate } from './temari'
import type { OpenBytes } from './dolbyStream'

const log = createLogger('appleHls')

/**
 * Apple Music 流式播放。
 *
 * Apple 的 ALAC 是按字节切片的 HLS：m3u8 里每段一个 #EXT-X-BYTERANGE，物理上是同一个
 * MP4 文件里的若干 [moof][mdat]。整首下载（40MB 起）+ 解密 + FFmpeg 重封装要十几秒，
 * 而 <audio> 要的只是「一个普通 MP4」——协议层的软解（audio/dolbyStream.ts）先读 moov
 * 算出 WAV 总长，之后按样本偏移要字节。
 *
 * 所以这里造一个虚拟文件：ftyp + 自己合成的扁平 moov + 按顺序首尾相接的明文样本。
 * 要哪一段就回源 Range 那一段、Temari 解掉、拼好吐出去，顺带按虚拟偏移写进临时文件；
 * 整首拉完把临时文件改名进 apple-audio 缓存，下次播放直接命中本地文件。分片索引阶段
 * 每段只取 32KB 的头部（trun 里的样本表），比整首 44MB 小三个数量级。
 */

/** 索引阶段每次取的窗口：一个 15s 的 alac 分片，moof 约 2–3KB，32KB 足够 */
const HEAD_WINDOW = 32 * 1024
/** 窗口不够（子样本信息特别多）时翻倍重试的次数 */
const HEAD_ATTEMPTS = 3
/** 往 <audio> 吐字节的块大小 */
const CHUNK_BYTES = 256 * 1024
/** 索引并发：与 net 层 per-host 闸对齐，别把额度一次占满（播放取流不走那层，但下载走） */
const INDEX_CONCURRENCY = 4
const RANGE_TIMEOUT = 60000
/** 已解密分片的内存池上限（多首歌共享，跨 seek 命中） */
const POOL_LIMIT = 24 * 1024 * 1024
/** 没有读者之后等多久删半截临时文件：切歌时 Chromium 会 cancel，留点余量给 seek 重开 */
const TEMP_IDLE_MS = 90_000

export interface AppleHlsOptions {
  /** 音频缓存键；给了就在整首拉完后落进 apple-audio，下次直接播本地文件 */
  cacheKey?: string | null
  signal?: AbortSignal
}

export interface AppleHlsTrack {
  /** 虚拟文件总长（等长于 ffmpeg 重封装出来的那份 MP4） */
  size: number
  open: OpenBytes
  dispose: () => void
}

// ============ 已解密分片的内存池 ============

interface PoolEntry {
  data: Uint8Array
  usedAt: number
}

const pool = new Map<string, PoolEntry>()
let poolBytes = 0
let poolClock = 0

function poolGet(key: string): Uint8Array | null {
  const entry = pool.get(key)
  if (!entry) return null
  entry.usedAt = ++poolClock
  return entry.data
}

function poolDelete(key: string): void {
  const entry = pool.get(key)
  if (!entry) return
  pool.delete(key)
  poolBytes -= entry.data.length
}

function poolPut(key: string, data: Uint8Array): void {
  poolDelete(key)
  pool.set(key, { data, usedAt: ++poolClock })
  poolBytes += data.length
  // 淘汰最久没被读到的分片，直到回到上限内（至少留一条，避免刚放进去就被自己删掉）
  while (poolBytes > POOL_LIMIT && pool.size > 1) {
    let oldestKey = ''
    let oldestAt = Infinity
    for (const [candidate, entry] of pool) {
      if (entry.usedAt < oldestAt) {
        oldestAt = entry.usedAt
        oldestKey = candidate
      }
    }
    if (!oldestKey) break
    poolDelete(oldestKey)
  }
}

// ============ 虚拟文件 ============

interface FragmentSlot {
  /** 远端分片起点（moof 的绝对偏移） */
  remoteStart: number
  remoteEnd: number
  /** 明文样本在虚拟文件里的起点 */
  virtualStart: number
  /** 明文样本总字节 */
  bytes: number
}

interface SegmentIndex {
  remoteStart: number
  sampleSizes: number[]
  sampleDurations: number[]
}

/**
 * 打开一路 Apple Music 流式播放：解析清单 → 扫各分片的样本表 → 合成扁平 moov →
 * 返回按虚拟偏移取字节的 open。第一个分片会顺手开始拉，首播不用等索引后的第一次 seek。
 *
 * 失败就抛，调用方（PLAYER_STREAM 的 am 分支）回退到整首下载那条路。
 */
export async function openAppleHlsTrack(
  spec: AppleAudioSpec,
  options: AppleHlsOptions = {}
): Promise<AppleHlsTrack> {
  const signal = options.signal
  const cacheKey = options.cacheKey && cacheEnabled() ? options.cacheKey : null

  const text = await requestText(spec.url, { timeout: 30000, signal })
  const playlist = parseApplePlaylist(spec.url, text)
  const segments = playlist.segments
  if (segments.length === 0) throw new Error('HLS 清单没有分片')
  const fileUrl = playlist.fileUrl

  // #EXT-X-MAP 被 parseApplePlaylist 忽略，但初始化段永远在文件最前面（0 起），
  // 也就是第一段之前的所有字节。
  const initEnd = segments[0].start
  if (!Number.isFinite(initEnd) || initEnd <= 0) throw new Error('HLS 清单缺少初始化段')
  const init = await fetchRange(fileUrl, 0, initEnd - 1, signal)
  const ftypBox = box(init, 0)
  if (ftypBox.type !== 'ftyp') throw new Error('HLS 初始化段开头不是 ftyp')
  const moovBox = box(init, ftypBox.end, initEnd)
  if (moovBox.type !== 'moov') throw new Error('HLS 初始化段里没有 moov')
  const ftyp = init.slice(ftypBox.start, ftypBox.end)
  // 去掉 pssh / senc 表、把 enca 换回明文格式（与整首解密同一套变换）
  const moov = transformInit(init, moovBox)
  const trex = readTrexTable(init, moovBox)
  const ivSize = readIvSize(init, moovBox)
  const timescale = trackTimescale(moov)
  const movieTimescale = mvhdTimescale(moov)
  const sampleRate = trackSampleRate(moov)
  if (!timescale) throw new Error('moov 缺少 mdhd timescale')
  assertAlac(moov)

  const templates = await createAppleTemplates(spec, segments, signal)
  try {
    const indexes = await mapLimit(segments, INDEX_CONCURRENCY, (segment) =>
      readSegmentIndex(fileUrl, segment, trex, ivSize, signal)
    )

    const sampleSizes: number[] = []
    const sampleDurations: number[] = []
    const slots: FragmentSlot[] = []
    let sampleBytes = 0
    for (const [position, index] of indexes.entries()) {
      if (index.sampleSizes.length === 0) throw new Error('HLS 分片没有样本')
      let bytes = 0
      for (const size of index.sampleSizes) bytes += size
      slots.push({
        remoteStart: index.remoteStart,
        remoteEnd: segments[position].end,
        virtualStart: 0,
        bytes
      })
      for (const size of index.sampleSizes) sampleSizes.push(size)
      for (const duration of index.sampleDurations) sampleDurations.push(duration)
      sampleBytes += bytes
    }

    // trun 没给时长（只有 size）时按 alac 帧长补齐：ALAC 每帧样本数固定，
    // 时长 = 帧长 / 采样率，正好落在 mdhd 的时基上。
    if (!sampleDurations.some((duration) => duration > 0)) {
      const frameLength = alacFrameLength(moov)
      if (!frameLength) throw new Error('分片没有样本时长，alac 帧长也读不到')
      for (let i = 0; i < sampleDurations.length; i++) sampleDurations[i] = frameLength
    }
    if (sampleDurations.some((duration) => duration <= 0)) throw new Error('样本时长无效')

    const trackDuration = sampleDurations.reduce((sum, duration) => sum + duration, 0)
    const movieDuration =
      movieTimescale > 0 ? Math.round((trackDuration * movieTimescale) / timescale) : trackDuration

    // 两遍定 stco：先拿占位偏移量出 moov 长度（长度只取决于样本数，与偏移无关），
    // 再按真实起点重算一遍。
    const stblParts = collectStbl(moov)
    const build = (offsets: Uint32Array): Uint8Array =>
      buildMoov(moov, stblParts, {
        sampleSizes,
        sampleDurations,
        offsets,
        trackDuration,
        movieDuration
      })
    const probe = build(new Uint32Array(sampleSizes.length))
    const base = ftyp.length + probe.length
    const totalSize = base + sampleBytes
    if (totalSize > 0xffffffff) throw new Error('Apple Music 曲目过大，超出 32 位偏移')

    const offsets = new Uint32Array(sampleSizes.length)
    let cursor = base
    for (let i = 0; i < sampleSizes.length; i++) {
      offsets[i] = cursor
      cursor += sampleSizes[i]
    }
    const builtMoov = build(offsets)
    if (builtMoov.length !== probe.length) throw new Error('合成 moov 长度不稳定')
    const header = new Uint8Array(base)
    header.set(ftyp, 0)
    header.set(builtMoov, ftyp.length)

    let virtual = base
    for (const slot of slots) {
      slot.virtualStart = virtual
      virtual += slot.bytes
    }

    log.info('Apple Music 流式就绪', {
      adamId: spec.adamId,
      segments: segments.length,
      samples: sampleSizes.length,
      sampleRate,
      timescale,
      seconds: Math.round(trackDuration / timescale),
      bytes: totalSize,
      cached: cacheKey !== null
    })

    const built = createTrack({
      spec,
      fileUrl,
      segments,
      slots,
      header,
      totalSize,
      trex,
      ivSize,
      templates,
      cacheKey,
      signal
    })
    // 首段先拉起来：真出声要等第一次读样本，这里提前几百毫秒开始。失败无所谓，
    // 正式取流会重试，别让它影响建流结果。
    if (!signal?.aborted) void built.warm().catch(() => {})
    return built
  } catch (error) {
    for (const template of templates.values()) template.close()
    throw error
  }
}

// ============ 取字节与落盘 ============

interface TrackInit {
  spec: AppleAudioSpec
  fileUrl: string
  segments: AppleSegment[]
  slots: FragmentSlot[]
  header: Uint8Array
  totalSize: number
  trex: TrexTable
  ivSize: number
  templates: Map<string, TemariTemplate>
  cacheKey: string | null
  signal?: AbortSignal
}

function createTrack(init: TrackInit): AppleHlsTrack & { warm: () => Promise<unknown> } {
  const { spec, fileUrl, segments, slots, header, totalSize, trex, ivSize, templates } = init
  const id = randomBytes(8).toString('hex')
  const abort = new AbortController()
  if (init.signal) {
    if (init.signal.aborted) abort.abort()
    else init.signal.addEventListener('abort', () => abort.abort(), { once: true })
  }

  let disposed = false
  let finalized = false
  const inflight = new Map<number, Promise<Uint8Array>>()

  // 缓存关掉时不要写临时文件：整首 45MB 写进去再删掉纯属浪费。
  const cacheWanted = init.cacheKey !== null
  let tempPath: string | null = null
  let tempHandle: FileHandle | null = null
  let tempBroken = false
  let recorded = 0
  const done = new Uint8Array(slots.length)

  // 半截的临时文件只有「这首歌还在播」时才有意义。切歌后 Chromium 会 cancel 那一路
  // body，读者数归零就起一个宽限计时：到点还没人读说明这次播放被放弃了，删掉。
  let readers = 0
  let idleTimer: ReturnType<typeof setTimeout> | null = null

  const clearIdle = (): void => {
    if (!idleTimer) return
    clearTimeout(idleTimer)
    idleTimer = null
  }

  const readerOpened = (): void => {
    readers++
    clearIdle()
  }

  const readerClosed = (): void => {
    if (readers > 0) readers--
    if (readers > 0 || finalized || disposed) return
    clearIdle()
    idleTimer = setTimeout(() => {
      idleTimer = null
      if (readers > 0 || finalized || disposed || !tempPath) return
      tempBroken = true
      void dropTemp()
    }, TEMP_IDLE_MS)
    idleTimer.unref?.()
  }

  async function fetchFragment(index: number): Promise<Uint8Array> {
    const slot = slots[index]
    const data = await fetchRange(fileUrl, slot.remoteStart, slot.remoteEnd, abort.signal)
    const moof = readBox(data, 0)
    if (!moof || moof.type !== 'moof') throw new Error('Apple Music 分片起点不是 moof')
    const info = parseAppleFragment(data, moof, trex, ivSize, slot.remoteStart)
    const template = templates.get(segments[index].keyUri)
    if (!template) throw new Error('缺少 Temari 密钥模板')
    const plain = decryptAppleSamples(data, info, template)
    if (plain.length !== slot.bytes) throw new Error('Apple Music 分片解密后长度不符')
    poolPut(`${id}:${index}`, plain)
    await recordFragment(index, plain)
    return plain
  }

  function loadFragment(index: number): Promise<Uint8Array> {
    const cached = poolGet(`${id}:${index}`)
    if (cached) return Promise.resolve(cached)
    const running = inflight.get(index)
    if (running) return running
    const task = fetchFragment(index)
    inflight.set(index, task)
    void task.catch(() => {}).finally(() => inflight.delete(index))
    return task
  }

  async function ensureTemp(): Promise<FileHandle> {
    if (tempHandle) return tempHandle
    const dir = appDataPath(DATA_CACHE_SUBDIR, 'apple-tmp')
    await mkdir(dir, { recursive: true })
    const path = join(dir, `hls-${randomBytes(8).toString('hex')}.m4a`)
    const handle = await openFile(path, 'w')
    tempPath = path
    tempHandle = handle
    await handle.write(header, 0, header.length, 0)
    return handle
  }

  async function closeTemp(): Promise<void> {
    const handle = tempHandle
    tempHandle = null
    if (handle) await handle.close().catch(() => {})
  }

  async function dropTemp(): Promise<void> {
    await closeTemp()
    const path = tempPath
    tempPath = null
    if (path) await rm(path, { force: true }).catch(() => {})
  }

  async function recordFragment(index: number, plain: Uint8Array): Promise<void> {
    if (!cacheWanted) return
    if (done[index] || tempBroken || disposed || finalized) return
    done[index] = 1
    recorded++
    try {
      const handle = await ensureTemp()
      await handle.write(plain, 0, plain.length, slots[index].virtualStart)
    } catch (error) {
      tempBroken = true
      log.warn('Apple Music 流式缓存写入失败', {
        adamId: spec.adamId,
        reason: error instanceof Error ? error.message : String(error)
      })
      await dropTemp()
      return
    }
    if (recorded === slots.length) await finalizeTemp()
  }

  async function finalizeTemp(): Promise<void> {
    if (finalized) return
    finalized = true
    await closeTemp()
    const path = tempPath
    tempPath = null
    if (!path) return
    if (!init.cacheKey) {
      await rm(path, { force: true }).catch(() => {})
      return
    }
    try {
      await storeAppleAudio(init.cacheKey, path, '.m4a')
      log.info('Apple Music 整首已落缓存', { adamId: spec.adamId, bytes: totalSize })
    } catch (error) {
      log.warn('Apple Music 缓存落盘失败', {
        adamId: spec.adamId,
        reason: error instanceof Error ? error.message : String(error)
      })
      await rm(path, { force: true }).catch(() => {})
    }
  }

  function fragmentAt(pos: number): number {
    let lo = 0
    let hi = slots.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >>> 1
      if (slots[mid].virtualStart <= pos) lo = mid
      else hi = mid - 1
    }
    return lo
  }

  async function* pump(start: number): AsyncGenerator<Uint8Array> {
    let pos = start
    if (pos < header.length) {
      for (let at = pos; at < header.length; at += CHUNK_BYTES) {
        yield header.subarray(at, Math.min(header.length, at + CHUNK_BYTES))
      }
      pos = header.length
    }
    while (pos < totalSize) {
      if (disposed) return
      const index = fragmentAt(pos)
      const plain = await loadFragment(index)
      if (disposed) return
      const slot = slots[index]
      let at = pos - slot.virtualStart
      if (at < 0) at = 0
      if (at >= plain.length) {
        pos = slot.virtualStart + slot.bytes
        continue
      }
      for (; at < plain.length; at += CHUNK_BYTES) {
        yield plain.subarray(at, Math.min(plain.length, at + CHUNK_BYTES))
      }
      pos = slot.virtualStart + slot.bytes
    }
  }

  const open: OpenBytes = async (start) => {
    if (disposed) throw new Error('Apple Music 流已释放')
    const from = Math.max(0, Math.min(Math.floor(start), totalSize))
    readerOpened()
    return { body: toStream(pump(from), readerClosed), size: totalSize }
  }

  return {
    size: totalSize,
    open,
    warm: () => loadFragment(0),
    dispose: () => {
      if (disposed) return
      disposed = true
      clearIdle()
      abort.abort()
      for (const template of templates.values()) template.close()
      for (const key of [...pool.keys()]) if (key.startsWith(`${id}:`)) poolDelete(key)
      inflight.clear()
      void dropTemp()
    }
  }
}

// ============ 分片索引 ============

/**
 * 量一个分片的样本表：只取分片头部，从 moof 的 trun / senc 里读出逐样本大小与时长。
 * 窗口不够（盒子被截断）就翻倍重取，最多 HEAD_ATTEMPTS 次。
 */
async function readSegmentIndex(
  fileUrl: string,
  segment: AppleSegment,
  trex: TrexTable,
  ivSize: number,
  signal?: AbortSignal
): Promise<SegmentIndex> {
  const length = segment.end - segment.start + 1
  if (length <= 0) throw new Error('HLS 分片范围无效')
  let window = HEAD_WINDOW
  for (let attempt = 0; ; attempt++) {
    const end = Math.min(segment.end, segment.start + window - 1)
    const data = await fetchRange(fileUrl, segment.start, end, signal)
    const info = locateFragment(data, trex, ivSize, segment.start)
    if (info) {
      if (info.samples.length === 0) throw new Error('HLS 分片没有样本')
      return {
        remoteStart: segment.start + info.moofStart,
        sampleSizes: info.samples.map((sample) => sample.size),
        sampleDurations: info.samples.map((sample) => sample.duration)
      }
    }
    if (data.length >= length || attempt >= HEAD_ATTEMPTS) break
    window *= 4
  }
  throw new Error('HLS 分片头解析失败')
}

/** 在窗口里找到 moof 并量出样本表；字节不够就返回 null（调用方扩大窗口） */
function locateFragment(
  data: Uint8Array,
  trex: TrexTable,
  ivSize: number,
  base: number
): AppleFragmentInfo | null {
  let pos = 0
  for (;;) {
    const current = readBox(data, pos)
    if (!current) return null
    if (current.type === 'moof') {
      let at = current.end
      for (;;) {
        // mdat 有 2.9MB，窗口里只会有它的头——这里只看头部，不要求盒体完整
        const next = readHeader(data, at)
        if (!next) return null
        if (next.type === 'mdat') return parseAppleFragment(data, current, trex, ivSize, base)
        if (next.type !== 'emsg' && next.type !== 'prft') {
          throw new Error(`HLS 分片里 moof 后面是 ${next.type}`)
        }
        at = next.end
      }
    }
    pos = current.end
  }
}

/**
 * 本地版盒读取：字节不够时返回 null 而不是抛（要拿它试探窗口大小）。
 * 其余语义与 fairplayMp4 的 box() 一致。
 */
function readBox(data: Uint8Array, pos: number): Box | null {
  if (pos + 8 > data.length) return null
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  let size = view.getUint32(pos)
  let header = 8
  const type = String.fromCharCode(data[pos + 4], data[pos + 5], data[pos + 6], data[pos + 7])
  if (size === 1) {
    if (pos + 16 > data.length) return null
    size = Number(view.getBigUint64(pos + 8))
    header = 16
  } else if (size === 0) {
    size = data.length - pos
  }
  if (size < header || pos + size > data.length) return null
  return { type, start: pos, end: pos + size, header, body: pos + header }
}

/** 同上，但允许盒体被窗口截断：只保证盒头在窗口里（mdat 只用到头部） */
function readHeader(data: Uint8Array, pos: number): Box | null {
  if (pos + 8 > data.length) return null
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  let size = view.getUint32(pos)
  let header = 8
  const type = String.fromCharCode(data[pos + 4], data[pos + 5], data[pos + 6], data[pos + 7])
  if (size === 1) {
    if (pos + 16 > data.length) return null
    size = Number(view.getBigUint64(pos + 8))
    header = 16
  } else if (size === 0) {
    size = data.length - pos
  }
  if (size < header) return null
  return { type, start: pos, end: pos + size, header, body: pos + header }
}

// ============ 合成扁平 moov ============

interface StblParts {
  stsd: Uint8Array
  mdia: Uint8Array[]
  minf: Uint8Array[]
}

/** 从明文 moov 里摘出 stsd 以及 mdia / minf 里除 stbl 之外的部分（hdlr / smhd / dinf 等） */
function collectStbl(moov: Uint8Array): StblParts {
  const root = box(moov, 0)
  const trak = findFirst(moov, root, 'trak')
  if (!trak) throw new Error('moov 里没有 trak')
  const mdia = findFirst(moov, trak, 'mdia')
  if (!mdia) throw new Error('trak 里没有 mdia')
  const minf = findFirst(moov, mdia, 'minf')
  if (!minf) throw new Error('mdia 里没有 minf')
  const stbl = findFirst(moov, minf, 'stbl')
  if (!stbl) throw new Error('minf 里没有 stbl')
  const stsd = findFirst(moov, stbl, 'stsd')
  if (!stsd) throw new Error('stbl 里没有 stsd')
  const parts = (parent: Box, skip: Set<string>): Uint8Array[] =>
    [...children(moov, parent)]
      .filter((child) => !skip.has(child.type))
      .map((child) => raw(moov, child.start, child.end).slice())
  return {
    stsd: raw(moov, stsd.start, stsd.end).slice(),
    mdia: parts(mdia, new Set(['mdhd', 'minf'])),
    minf: parts(minf, new Set(['stbl']))
  }
}

interface MoovParts {
  sampleSizes: number[]
  sampleDurations: number[]
  offsets: Uint32Array
  trackDuration: number
  movieDuration: number
}

/**
 * 拼一个普通的（非分片）moov：stbl 全从样本表重建，stsc 一段一样本（1 个 chunk / 样本），
 * stco 直接给逐样本绝对偏移。mvex / udta / edts 丢掉——扁平文件用不上它们。
 */
function buildMoov(moov: Uint8Array, parts: StblParts, data: MoovParts): Uint8Array {
  const root = box(moov, 0)
  const mvhd = findFirst(moov, root, 'mvhd')
  const trak = findFirst(moov, root, 'trak')
  if (!mvhd || !trak) throw new Error('moov 里缺少 mvhd / trak')
  const tkhd = findFirst(moov, trak, 'tkhd')
  const mdia = findFirst(moov, trak, 'mdia')
  if (!tkhd || !mdia) throw new Error('trak 里缺少 tkhd / mdia')
  const mdhd = findFirst(moov, mdia, 'mdhd')
  if (!mdhd) throw new Error('mdia 里缺少 mdhd')

  const runs: { count: number; delta: number }[] = []
  for (const duration of data.sampleDurations) {
    const last = runs[runs.length - 1]
    if (last && last.delta === duration) last.count++
    else runs.push({ count: 1, delta: duration })
  }

  const stts = fullBox(
    'stts',
    u32Bytes(runs.length),
    ...runs.flatMap((run) => [u32Bytes(run.count), u32Bytes(run.delta)])
  )
  const stsz = fullBox(
    'stsz',
    u32Bytes(0),
    u32Bytes(data.sampleSizes.length),
    ...data.sampleSizes.map((size) => u32Bytes(size))
  )
  const stsc = fullBox('stsc', u32Bytes(1), u32Bytes(1), u32Bytes(1), u32Bytes(1))
  const stco = fullBox('stco', u32Bytes(data.offsets.length), ...Array.from(data.offsets, u32Bytes))

  const stbl = makeBox('stbl', parts.stsd, stts, stsz, stsc, stco)
  const minf = makeBox('minf', ...parts.minf, stbl)
  const mdiaBox = makeBox('mdia', withDuration(moov, mdhd, data.trackDuration), ...parts.mdia, minf)
  const trakBox = makeBox('trak', withDuration(moov, tkhd, data.movieDuration), mdiaBox)
  return makeBox('moov', withDuration(moov, mvhd, data.movieDuration), trakBox)
}

/** 复制一个盒并改写它的 duration（mvhd/tkhd 用 movie 时基，mdhd 用轨道时基） */
function withDuration(data: Uint8Array, target: Box, duration: number): Uint8Array {
  const output = raw(data, target.start, target.end).slice()
  const view = new DataView(output.buffer, output.byteOffset, output.byteLength)
  const version = data[target.body]
  const at = (absolute: number): number => absolute - target.start
  const write32 = (offset: number): void => view.setUint32(at(offset), duration >>> 0)
  const write64 = (offset: number): void => view.setBigUint64(at(offset), BigInt(duration))
  if (target.type === 'mvhd') {
    if (version === 1) write64(target.body + 24)
    else write32(target.body + 16)
  } else if (target.type === 'tkhd') {
    if (version === 1) write64(target.body + 28)
    else write32(target.body + 20)
  } else if (target.type === 'mdhd') {
    if (version === 1) write64(target.body + 24)
    else write32(target.body + 16)
  }
  return output
}

function fullBox(type: string, ...parts: Uint8Array[]): Uint8Array {
  return makeBox(type, new Uint8Array(4), ...parts)
}

function u32Bytes(value: number): Uint8Array {
  const output = new Uint8Array(4)
  new DataView(output.buffer).setUint32(0, value >>> 0)
  return output
}

// ============ moov 里的元信息 ============

function findFirst(data: Uint8Array, parent: Box, type: string): Box | null {
  for (const child of children(data, parent)) if (child.type === type) return child
  return null
}

function trackTimescale(moov: Uint8Array): number {
  const mdhd = findAll(moov, box(moov, 0), 'mdhd')[0]
  if (!mdhd) return 0
  return moov[mdhd.body] === 1 ? u32(moov, mdhd.body + 20) : u32(moov, mdhd.body + 12)
}

function mvhdTimescale(moov: Uint8Array): number {
  const root = box(moov, 0)
  const mvhd = findFirst(moov, root, 'mvhd')
  if (!mvhd) return 0
  return moov[mvhd.body] === 1 ? u32(moov, mvhd.body + 20) : u32(moov, mvhd.body + 12)
}

/** stsd 第一条的 16.16 采样率（仅用于日志与自检）；Entry 里 +24 是声道/位深，采样率在 +32 */
function trackSampleRate(moov: Uint8Array): number {
  const stsd = findAll(moov, box(moov, 0), 'stsd')[0]
  if (!stsd) return 0
  for (const entry of children(moov, stsd, stsd.body + 8)) return u32(moov, entry.start + 32) >>> 16
  return 0
}

function assertAlac(moov: Uint8Array): void {
  const stsd = findAll(moov, box(moov, 0), 'stsd')[0]
  if (!stsd) throw new Error('moov 里没有 stsd')
  for (const entry of children(moov, stsd, stsd.body + 8)) {
    if (entry.type === 'alac') return
    throw new Error(`流式播放只支持 ALAC，样本描述是 ${entry.type}`)
  }
  throw new Error('stsd 没有样本描述')
}

/** alac 的帧长（样本数/帧），从 stsd 第一条里的 alac cookie 读 */
function alacFrameLength(moov: Uint8Array): number {
  const stsd = findAll(moov, box(moov, 0), 'stsd')[0]
  if (!stsd) return 0
  for (const entry of children(moov, stsd, stsd.body + 8)) {
    if (entry.type !== 'alac') continue
    for (const cookie of children(moov, entry, entry.body + 28)) {
      if (cookie.type === 'alac') return u32(moov, cookie.body + 4)
    }
  }
  return 0
}

/** tenc 的默认 IV 长度；跳块加密（常 IV + 显式 IV）暂不支持 */
function readIvSize(data: Uint8Array, moov: Box): number {
  const tenc = findAll(data, moov, 'tenc')[0]
  if (!tenc) return 0
  const version = data[tenc.body]
  if (version > 0 && (data[tenc.body + 5] & 15) !== 0) {
    throw new Error('暂不支持跳块加密的 Apple Music 码流')
  }
  return data[tenc.body + 7]
}

// ============ 工具 ============

function cacheEnabled(): boolean {
  const limit = getSettings().player.audioCacheBytes
  return Number.isFinite(limit) && limit > 0
}

/** 只取 [start, end] 这段字节；服务端忽略 Range 回整份时自己跳前缀 */
async function fetchRange(
  url: string,
  start: number,
  end: number,
  signal?: AbortSignal
): Promise<Uint8Array> {
  const length = end - start + 1
  // 早停时必须 abort 那次 fetch——只 cancel body 不归还 socket（见 CLAUDE.md 取流那节）
  const controller = new AbortController()
  const forward = (): void => controller.abort()
  if (signal) {
    if (signal.aborted) controller.abort()
    else signal.addEventListener('abort', forward, { once: true })
  }
  try {
    const response = await requestRaw(url, {
      headers: { Range: `bytes=${start}-${end}` },
      timeout: RANGE_TIMEOUT,
      signal: controller.signal
    })
    if (!response.ok || !response.body) {
      drainResponse(response)
      throw new Error(`Apple Music 分片请求失败 (${response.status})`)
    }
    const skip = response.status === 206 ? 0 : start
    // CDN 正常时按 206 + 精确长度回，整份读完可复用连接；服务端忽略 Range 才退回早停
    const exact =
      response.status === 206 && Number(response.headers.get('content-length') ?? -1) === length
    const chunks: Uint8Array[] = []
    let total = 0
    let complete = false
    const reader = response.body.getReader()
    try {
      while (exact ? !complete : total < skip + length) {
        const { done, value } = await reader.read()
        if (done) {
          complete = true
          break
        }
        if (!value) continue
        chunks.push(value)
        total += value.length
      }
    } finally {
      if (!complete) {
        controller.abort()
        void reader.cancel().catch(() => {})
      }
    }
    if (total < skip + length) throw new Error('Apple Music 分片响应不完整')
    const all = new Uint8Array(total)
    let at = 0
    for (const chunk of chunks) {
      all.set(chunk, at)
      at += chunk.length
    }
    return all.subarray(skip, skip + length)
  } finally {
    signal?.removeEventListener('abort', forward)
  }
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  let failure: unknown = null
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      if (failure) return
      const index = next++
      if (index >= items.length) return
      try {
        results[index] = await task(items[index], index)
      } catch (error) {
        if (!failure) failure = error
        return
      }
    }
  })
  await Promise.all(workers)
  if (failure) throw failure
  return results
}

/** AsyncGenerator → ReadableStream：cancel 先让生成器退出，回收在途请求 */
function toStream(
  gen: AsyncGenerator<Uint8Array>,
  onClose: () => void
): ReadableStream<Uint8Array> {
  let stopped = false
  const finish = (): void => {
    if (stopped) return
    stopped = true
    onClose()
  }
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await gen.next()
        if (stopped) return
        if (done) {
          controller.close()
          finish()
          return
        }
        controller.enqueue(value)
      } catch (error) {
        if (stopped) return
        controller.error(error)
        finish()
      }
    },
    cancel() {
      if (stopped) return
      stopped = true
      onClose()
      // 异步生成器取消不掉卡在 await 里的自己：先 return 再让它自然退出
      void gen.return(undefined).catch(() => {})
    }
  })
}
