import { randomBytes } from 'node:crypto'
import { mkdir, open as openFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { DATA_CACHE_SUBDIR, appDataPath } from '../core/paths'
import { createLogger } from '../core/logger'

const log = createLogger('appleMusic')
import { getAppleAudio, storeAppleAudio } from '../cache/appleCache'
import { amPost } from '../providers/am/api'
import { drainResponse, requestRaw, requestText, runBulk } from '../net/request'
import { HttpStatusError, downloadSegmented } from '../net/segmented'
import { decryptAppleMp4, parseApplePlaylist } from './fairplayMp4'
import type { AppleSegment } from './fairplayMp4'
import { remuxAppleMp4 } from './ffmpeg'
import { TemariTemplate } from './temari'

export interface AppleAudioSpec {
  url: string
  adamId: string
  keyEndpoint: string
}

export interface AppleDownloadOptions {
  signal?: AbortSignal
  onProgress?: (downloaded: number, total: number) => void
  metadata?: Record<string, string>
}

/**
 * 整份加密 fMP4 拉进内存。走多连接分段（net/segmented）：无损一首 40MB 上下，单连接要等很久，
 * 而这条路是「先整首下完才能解密重封装」，下载多快首播就多快。
 */
async function downloadEncrypted(url: string, options: AppleDownloadOptions): Promise<Buffer> {
  let total = 0
  let downloaded = 0
  /** 知道总长时一次分配好，各分段按偏移直接拷进去 */
  let whole: Buffer | null = null
  /** 服务端不认 Range 又没给长度时的兜底：单连接顺序到达，按序攒 */
  const chunks: Buffer[] = []
  try {
    const result = await downloadSegmented({
      open: (range, signal) =>
        requestRaw(url, {
          headers: range ? { Range: range } : undefined,
          timeout: 120000,
          signal
        }),
      write: async (data, position) => {
        if (whole) whole.set(data, position)
        else chunks.push(Buffer.from(data))
      },
      gate: (task) => runBulk(url, task),
      release: drainResponse,
      signal: options.signal,
      onSize: (size) => {
        total = size
        whole = Buffer.allocUnsafe(size)
      },
      onProgress: (bytes) => {
        downloaded += bytes
        options.onProgress?.(downloaded, total)
      }
    })
    const buffer = whole as Buffer | null
    return buffer ? buffer.subarray(0, result.size) : Buffer.concat(chunks)
  } catch (error) {
    if (error instanceof HttpStatusError) {
      throw new Error(`Apple Music 音频下载失败 (${error.status})`)
    }
    throw error
  }
}

/**
 * 按分片里出现的 keyUri 拉 Temari 模板（中途换密钥时会有多个，最多见过两个）。
 * 整首下载与流式播放共用：都只认 skd:// 上的 keyUri，解码靠后端 /music/key 下发。
 */
export async function createAppleTemplates(
  spec: AppleAudioSpec,
  segments: AppleSegment[],
  signal?: AbortSignal
): Promise<Map<string, TemariTemplate>> {
  const templates = new Map<string, TemariTemplate>()
  try {
    for (const segment of segments) {
      if (templates.has(segment.keyUri)) continue
      signal?.throwIfAborted()
      if (!segment.keyUri) throw new Error('HLS 分片缺少密钥 URI')
      // 公共段（P000000000）不是某首歌的密钥，音乐 ID 必须给 0
      const adamId =
        segment.keyUri === 'skd://itunes.apple.com/P000000000/s1/e1' ? '0' : spec.adamId
      const response = await amPost(spec.keyEndpoint, {
        source: 'am',
        musicId: adamId,
        uri: segment.keyUri
      })
      if (!response.data || typeof response.data !== 'object') {
        throw new Error('后端没有返回有效的 Temari 密钥模板')
      }
      templates.set(segment.keyUri, new TemariTemplate(JSON.stringify(response.data)))
    }
    return templates
  } catch (error) {
    for (const template of templates.values()) template.close()
    throw error
  }
}

export async function downloadAppleAudio(
  spec: AppleAudioSpec,
  outputPath: string,
  options: AppleDownloadOptions = {}
): Promise<void> {
  const text = await requestText(spec.url, { timeout: 30000, signal: options.signal })
  const playlist = parseApplePlaylist(spec.url, text)
  log.info('HLS 清单解析完成', { adamId: spec.adamId, segments: playlist.segments.length })
  const startedAt = Date.now()
  const encrypted = await downloadEncrypted(playlist.fileUrl, options)
  const ms = Math.max(1, Date.now() - startedAt)
  log.info('加密分片下载完成', {
    adamId: spec.adamId,
    bytes: encrypted.length,
    ms,
    kbps: Math.round(encrypted.length / 1024 / (ms / 1000))
  })
  const templates = await createAppleTemplates(spec, playlist.segments, options.signal)
  const tempDir = appDataPath(DATA_CACHE_SUBDIR, 'apple-tmp')
  await mkdir(tempDir, { recursive: true })
  const id = randomBytes(8).toString('hex')
  const fragmentPath = join(tempDir, `${id}.fmp4`)
  try {
    log.info('Temari 模板准备完成', { adamId: spec.adamId, count: templates.size })
    const decryptStart = Date.now()
    const parts = await decryptAppleMp4(
      encrypted,
      playlist.segments,
      (keyUri) => {
        const template = templates.get(keyUri)
        if (!template) throw new Error('缺少 Temari 密钥模板')
        return template
      },
      options.signal
    )
    // 分块顺序写盘，不再拼成一整块（省一次整首大小的分配）
    const handle = await openFile(fragmentPath, 'w')
    try {
      for (const part of parts) await handle.writeFile(part)
    } finally {
      await handle.close()
    }
    log.info('解密完成', { adamId: spec.adamId, ms: Date.now() - decryptStart })
    await mkdir(dirname(outputPath), { recursive: true })
    await remuxAppleMp4(fragmentPath, outputPath, options.signal, { metadata: options.metadata })
    log.info('音频重封装完成', { adamId: spec.adamId })
  } finally {
    for (const template of templates.values()) template.close()
    await rm(fragmentPath, { force: true }).catch(() => {})
  }
}

const pendingAudio = new Map<string, Promise<string>>()

export async function prepareAppleAudio(
  spec: AppleAudioSpec,
  cacheKey: string,
  options: AppleDownloadOptions = {}
): Promise<string> {
  const cached = getAppleAudio(cacheKey)
  if (cached) return cached
  const pending = pendingAudio.get(cacheKey)
  if (pending) return pending
  const task = (async () => {
    const tempDir = appDataPath(DATA_CACHE_SUBDIR, 'apple-tmp')
    await mkdir(tempDir, { recursive: true })
    const output = join(tempDir, `${randomBytes(8).toString('hex')}.m4a`)
    try {
      await downloadAppleAudio(spec, output, options)
      return await storeAppleAudio(cacheKey, output, '.m4a')
    } finally {
      await rm(output, { force: true }).catch(() => {})
    }
  })()
  pendingAudio.set(cacheKey, task)
  try {
    return await task
  } finally {
    pendingAudio.delete(cacheKey)
  }
}

export async function embedAppleMetadata(
  filePath: string,
  options: { metadata: Record<string, string>; lyrics?: string; cover?: Buffer }
): Promise<void> {
  const tempDir = appDataPath(DATA_CACHE_SUBDIR, 'apple-tmp')
  await mkdir(tempDir, { recursive: true })
  const id = randomBytes(8).toString('hex')
  const output = join(tempDir, `${id}.m4a`)
  const coverPath = options.cover ? join(tempDir, `${id}.jpg`) : ''
  try {
    if (options.cover) await writeFile(coverPath, options.cover)
    await remuxAppleMp4(filePath, output, undefined, {
      metadata: options.metadata,
      lyrics: options.lyrics,
      coverPath: coverPath || undefined
    })
    await rm(filePath, { force: true })
    await rename(output, filePath)
  } finally {
    await rm(output, { force: true }).catch(() => {})
    if (coverPath) await rm(coverPath, { force: true }).catch(() => {})
  }
}
