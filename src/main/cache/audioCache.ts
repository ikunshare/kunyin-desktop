/**
 * 播放音频磁盘缓存（分块）。
 *
 * 与 urlCache 的分工：urlCache 只存直链（后端 `_cacheTTL` 默认 600s 就失效，且直链带
 * 一次性签名），命中也只省掉一次解析——音频照样从 CDN 重下。本模块存的是**解密后**的
 * 音频字节，完整命中时 PLAYER_STREAM 直接走本地，后端 getUrl 与 CDN 下载全都省掉。
 *
 * 布局：
 *   data/cache/audio/<key>/<key>_<序号>.kunyin   分块数据
 *   data/cache/audio-index.json                  索引（LRU 序 + 总长 + 已有块）
 *   key = platform_id_quality
 *
 * 为什么分块而不是整文件：
 * - 切歌/seek 打断下载时，已下满的块留得住，下次接着补而不是从头再来；
 * - seek 到中段能只回源缺的那几块，前面已有的块直接本地读。
 * 半块一律不落盘，所以索引里的块永远是完整的——读取侧不必关心「块只写了一半」。
 *
 * 加密格式（QQ mflac/mgg 等）存的是解密**之后**的数据：既不必连 ekey 一起存，
 * 重听时也省掉重复解密。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { readdir, rename, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { getMusicItemKey, type MusicItem } from '@common'
import { appDataPath, DATA_CACHE_SUBDIR } from '../core/paths'
import { getSettings } from '../store/settings'

/**
 * 块大小 1 MiB：小到切歌时能留下有意义的进度，大到不会让一首歌散成几千个文件
 * （一首 30 MB 的 FLAC 约 30 块）。记在条目里，日后调整不会读错旧缓存。
 */
const BLOCK_SIZE = 1024 * 1024

const INDEX_FILE = 'audio-index.json'
const AUDIO_SUBDIR = 'audio'
const BLOCK_EXT = '.kunyin'

/** 运行时条目。blocks 用 Set，落盘时转成数组。 */
export interface CacheRecord {
  /** 完整音频总字节数 */
  size: number
  /** 该条目写入时用的块大小 */
  blockSize: number
  /** 已完整落盘的块序号 */
  blocks: Set<number>
  /** 服务该音频时用的 Content-Type（与首次播放时发给 <audio> 的一致） */
  contentType: string
  usedAt: number
}

/** 索引文件里的形状（blocks 为数组） */
interface StoredRecord extends Omit<CacheRecord, 'blocks'> {
  blocks: number[]
}

function audioDir(): string {
  return appDataPath(DATA_CACHE_SUBDIR, AUDIO_SUBDIR)
}

function indexPath(): string {
  return appDataPath(DATA_CACHE_SUBDIR, INDEX_FILE)
}

/** key 直接用作目录名与文件名前缀；正常的 platform_id_quality 全是安全字符，这里只做兜底 */
function safeName(key: string): string {
  return key.replace(/[^A-Za-z0-9_-]/g, '-')
}

function recordDir(key: string): string {
  return join(audioDir(), safeName(key))
}

/** 块文件绝对路径：<key>/<key>_<序号>.kunyin */
export function blockPath(key: string, index: number): string {
  const name = safeName(key)
  return join(audioDir(), name, `${name}_${index}${BLOCK_EXT}`)
}

/** Map 迭代序即 LRU 序：命中时 delete+set 提到末尾，淘汰从头部取。 */
let index = new Map<string, CacheRecord>()
let totalBytes = 0
let loaded = false
let saveTimer: NodeJS.Timeout | null = null

/** 缓存容量上限（字节）。0 或负数表示关闭缓存。 */
function limitBytes(): number {
  const value = getSettings().player.audioCacheBytes
  return Number.isFinite(value) && value > 0 ? value : 0
}

/** 第 index 块覆盖的字节区间（闭区间）。末块通常不满一整块。 */
export function blockRange(record: CacheRecord, index: number): { start: number; end: number } {
  const start = index * record.blockSize
  return { start, end: Math.min(record.size - 1, start + record.blockSize - 1) }
}

export function blockCount(record: CacheRecord): number {
  return Math.ceil(record.size / record.blockSize)
}

function blockLength(record: CacheRecord, index: number): number {
  const { start, end } = blockRange(record, index)
  return end - start + 1
}

function recordBytes(record: CacheRecord): number {
  let sum = 0
  for (const i of record.blocks) sum += blockLength(record, i)
  return sum
}

function recount(): void {
  let sum = 0
  for (const record of index.values()) sum += recordBytes(record)
  totalBytes = sum
}

function ensureLoaded(): void {
  if (loaded) return
  loaded = true
  try {
    const raw = readFileSync(indexPath(), 'utf-8')
    const entries = JSON.parse(raw) as [string, StoredRecord][]
    if (Array.isArray(entries)) {
      index = new Map(entries.map(([key, r]) => [key, { ...r, blocks: new Set(r.blocks ?? []) }]))
    }
  } catch {
    /* 首次或文件损坏：空缓存 */
  }
  recount()
  void pruneOrphans()
}

function writeIndex(): void {
  try {
    const dir = appDataPath(DATA_CACHE_SUBDIR)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const path = indexPath()
    const tmp = `${path}.tmp`
    const stored: [string, StoredRecord][] = [...index].map(([key, r]) => [
      key,
      { ...r, blocks: [...r.blocks].sort((a, b) => a - b) }
    ])
    // 索引只有条目元信息，同步写的代价可忽略
    writeFileSync(tmp, JSON.stringify(stored), 'utf-8')
    renameSync(tmp, path)
  } catch {
    /* 索引写失败：下次启动退化为孤儿目录，由 pruneOrphans 收走 */
  }
}

function persist(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    writeIndex()
  }, 500)
}

/** 从索引与磁盘上一起去掉一条（淘汰、损坏、清空都走这里） */
function dropEntry(key: string): void {
  const record = index.get(key)
  if (!record) return
  index.delete(key)
  totalBytes -= recordBytes(record)
  if (totalBytes < 0) totalBytes = 0
  void rm(recordDir(key), { recursive: true, force: true }).catch(() => {
    /* 有块正被写：留给 pruneOrphans */
  })
}

/** 超出上限时按 LRU 从最久未用的开始整条删，直到回到上限内 */
function evict(): void {
  const limit = limitBytes()
  for (const key of [...index.keys()]) {
    if (totalBytes <= limit) break
    dropEntry(key)
  }
}

/**
 * 收走索引里没有的目录与块文件：进程崩溃留下的 .tmp、索引写失败后成为孤儿的数据。
 * 不做这一步，异常退出的残留会永久占盘且不计入用量统计。
 */
async function pruneOrphans(): Promise<void> {
  const dir = audioDir()
  let dirs: string[]
  try {
    dirs = await readdir(dir)
  } catch {
    return
  }
  const known = new Map<string, CacheRecord>()
  for (const [key, record] of index) known.set(safeName(key), record)
  for (const name of dirs) {
    const record = known.get(name)
    if (!record) {
      await rm(join(dir, name), { recursive: true, force: true }).catch(() => {})
      continue
    }
    // 目录在索引里：把索引没记录的块文件（写了一半的 .tmp 等）收掉
    const wanted = new Set<string>()
    for (const i of record.blocks) wanted.add(`${name}_${i}${BLOCK_EXT}`)
    const files = await readdir(join(dir, name)).catch(() => [] as string[])
    for (const file of files) {
      if (wanted.has(file)) continue
      await unlink(join(dir, name, file)).catch(() => {})
    }
  }
}

/** 缓存键：platform_id_quality（getMusicItemKey 已是 platform_id） */
export function audioCacheKey(item: MusicItem, qualityId: string): string {
  return `${getMusicItemKey(item)}_${qualityId}`
}

/** 取条目并提到 LRU 末尾；不存在返回 null。 */
export function getAudioCacheRecord(key: string): CacheRecord | null {
  if (limitBytes() <= 0) return null
  ensureLoaded()
  const record = index.get(key)
  if (!record) return null
  record.usedAt = Date.now()
  index.delete(key)
  index.set(key, record)
  persist()
  return record
}

/** 是否所有块都在（完整命中时连直链解析都能省掉） */
export function isAudioFullyCached(key: string): boolean {
  const record = getAudioCacheRecord(key)
  return !!record && record.blocks.size >= blockCount(record)
}

/**
 * 建立（或复用）条目。首次播放从上游响应头拿到总长度后调用。
 * 总长或 Content-Type 与已有条目不符时视为换了资源，整条重建。
 * @returns null 表示不缓存（缓存关闭 / 这首比上限还大 / 总长非法）
 */
export function ensureAudioCacheRecord(
  key: string,
  size: number,
  contentType: string
): CacheRecord | null {
  const limit = limitBytes()
  if (limit <= 0) return null
  // 比上限还大的单曲缓存不下（塞进去会把其它全挤掉，自己也留不住）
  if (!Number.isFinite(size) || size <= 0 || size > limit) return null
  ensureLoaded()
  const exist = index.get(key)
  if (exist) {
    if (exist.size === size && exist.contentType === contentType) return exist
    dropEntry(key)
  }
  const record: CacheRecord = {
    size,
    blockSize: BLOCK_SIZE,
    blocks: new Set(),
    contentType,
    usedAt: Date.now()
  }
  index.set(key, record)
  persist()
  return record
}

/**
 * 校验某个本地块是否真的可用（大小对得上）。
 * 对不上就从索引剔除当作缺块——读取侧会自动回源补齐，不必整条失效。
 */
export async function verifyBlock(
  key: string,
  record: CacheRecord,
  blockIndex: number
): Promise<boolean> {
  if (!record.blocks.has(blockIndex)) return false
  let size = -1
  try {
    size = (await stat(blockPath(key, blockIndex))).size
  } catch {
    size = -1
  }
  if (size === blockLength(record, blockIndex)) return true
  record.blocks.delete(blockIndex)
  totalBytes -= blockLength(record, blockIndex)
  if (totalBytes < 0) totalBytes = 0
  persist()
  return false
}

/** 落一个完整块。data 长度必须等于该块应有长度，否则忽略。 */
async function commitBlock(
  key: string,
  record: CacheRecord,
  blockIndex: number,
  data: Buffer
): Promise<void> {
  if (index.get(key) !== record) return // 条目已被淘汰/重建
  if (record.blocks.has(blockIndex)) return
  if (data.length !== blockLength(record, blockIndex)) return
  const path = blockPath(key, blockIndex)
  // tmp 名带随机后缀：<audio> 首帧常同时开两路请求，两个 writer 可能同时落同一块，
  // 固定名会撞在一起。各写各的再 rename，后者覆盖前者（内容本就相同）。
  const tmp = `${path}.${randomBytes(4).toString('hex')}.tmp`
  try {
    const dir = recordDir(key)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    // 异步写：主进程主线程同时要响应取流 IPC 并搬运音频数据块，
    // 每 MiB 同步写一次会直接卡住播放
    await writeFile(tmp, data)
    await rename(tmp, path)
  } catch {
    void rm(tmp, { force: true }).catch(() => {})
    return
  }
  // 落盘期间条目可能已被淘汰：再确认一次，别把字节数算到已消失的条目上
  if (index.get(key) !== record) {
    void rm(path, { force: true }).catch(() => {})
    return
  }
  record.blocks.add(blockIndex)
  totalBytes += data.length
  evict()
  persist()
}

export interface BlockWriter {
  /** 按文件绝对偏移顺序喂数据 */
  write(chunk: Uint8Array): void
  /** 收尾：凑满的末块落盘，没凑满的丢弃 */
  finish(): void
}

/**
 * 块写入器：按绝对偏移顺序喂数据，内部按块边界切分，**写满一整块才落盘**。
 *
 * 起点不在块边界时（seek 后的中段请求），前面那点零头会被跳过——只有从块头连续
 * 写满的块才提交，索引里因此不会出现残缺块。中途断流也不用特殊处理：已满的块
 * 早就落盘了，正在攒的那块丢掉即可。
 */
export function openBlockWriter(
  key: string,
  record: CacheRecord,
  startOffset: number
): BlockWriter {
  const bs = record.blockSize
  let offset = startOffset
  let bufBlock = -1
  let buf: Buffer[] = []
  let bufLen = 0

  const reset = (block: number): void => {
    bufBlock = block
    buf = []
    bufLen = 0
  }

  return {
    write(chunk) {
      let data = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)
      while (data.length > 0) {
        const idx = Math.floor(offset / bs)
        const blockStart = idx * bs
        const len = blockLength(record, idx)
        const posInBlock = offset - blockStart
        const take = Math.min(len - posInBlock, data.length)
        if (bufBlock !== idx) reset(idx)
        // 只有从块头开始且一直连续，才值得攒；否则这一块跳过（下次从头下时再补）
        if (posInBlock === bufLen) {
          buf.push(Buffer.from(data.subarray(0, take)))
          bufLen += take
          if (bufLen === len) {
            void commitBlock(key, record, idx, Buffer.concat(buf, bufLen))
            reset(-1)
          }
        }
        offset += take
        data = data.subarray(take)
      }
    },
    finish() {
      // 满块在 write 里就提交了；这里只剩没凑满的零头，直接丢
      reset(-1)
    }
  }
}

/** [start, end] 被切出的一段：要么整段读本地块，要么整段回源 */
export interface RangeSegment {
  /** 数据来自本地块 */
  local: boolean
  /** 要吐给调用方的绝对字节区间（闭区间） */
  emitStart: number
  emitEnd: number
  /** 回源区间（块对齐；仅 local=false 时有意义） */
  fetchStart: number
  fetchEnd: number
}

/**
 * 把 [start, end] 按「本地已有块 / 缺块」切段，连续同类块合成一段
 * （本地段一次读到底，缺块段一次回源，避免一块一个请求）。
 *
 * 缺块段的回源区间向前后补齐到整块边界：落盘的块必须是完整的，否则索引里会出现
 * 残缺块。emit 区间则严格是调用方要的那部分——两者的差值就是「多下一点、少发一点」。
 *
 * 不变式：各段 emit 区间首尾相接且恰好覆盖 [start, end]，总字节数 = end - start + 1。
 * Content-Length 依赖这条，纯函数化就是为了能直接测它。
 */
export function planRange(
  record: CacheRecord,
  hasBlock: (index: number) => boolean,
  start: number,
  end: number
): RangeSegment[] {
  const bs = record.blockSize
  const segments: RangeSegment[] = []
  const lastIndex = Math.floor(end / bs)
  let pos = start
  while (pos <= end) {
    const idx = Math.floor(pos / bs)
    const local = hasBlock(idx)
    let tail = idx
    while (tail + 1 <= lastIndex && hasBlock(tail + 1) === local) tail++
    const emitEnd = Math.min(end, blockRange(record, tail).end)
    segments.push({
      local,
      emitStart: pos,
      emitEnd,
      fetchStart: idx * bs,
      fetchEnd: blockRange(record, tail).end
    })
    pos = emitEnd + 1
  }
  return segments
}

/** 用量统计（设置页「缓存管理」） */
export function audioCacheStats(): { bytes: number; count: number } {
  ensureLoaded()
  return { bytes: totalBytes, count: index.size }
}

/**
 * 丢弃一条音频缓存。
 *
 * 播放失败（PLAYER_URL_INVALIDATE）时必须连这里一起失效：完整命中的那一路根本不碰网络，
 * 只失效 urlCache 的话重试还会撞上同一份坏数据，这首歌就永远播不了了。
 * 单块的大小校验能挡住写截断，但挡不住内容本身有问题（例如某格式的解密器不对）。
 */
export function dropCachedAudio(key: string): void {
  ensureLoaded()
  if (!index.has(key)) return
  dropEntry(key)
  persist()
}

/** 清空音频缓存（设置页清理按钮，以及把上限调成 0 时） */
export async function clearAudioCache(): Promise<void> {
  ensureLoaded()
  index.clear()
  totalBytes = 0
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  writeIndex()
  await rm(audioDir(), { recursive: true, force: true }).catch(() => {
    /* 有块正被写入：留给 pruneOrphans */
  })
}

/** 上限调小/关闭后立即收敛到新上限（设置项变更时调用） */
export function applyAudioCacheLimit(): void {
  if (limitBytes() <= 0) {
    void clearAudioCache()
    return
  }
  ensureLoaded()
  evict()
  persist()
}
