/**
 * 下载队列管理（1:1 移植自 Android manager/DownloadManager.kt，去掉 Android SAF/DocumentFile，
 * 用 Node fs）。
 *
 * - taskKey = `source_id_qualityId`；状态机 waiting/downloading/paused/completed/failed。
 * - 并发上限用信号量（settings.download.maxConcurrent）；进度节流 500ms。
 * - 加密流（QQ ekey）：先下原始密文到 .tmp，完成后用 crypto/mflac 原地解密，再嗅探真实容器修正扩展名。
 * - 命名规则、采样率标记、整专封面 first-write-wins 对齐 Android。
 * - 完成后用 tag/（自 Android utils/tag 移植）内嵌写 title/artist/album/cover/lyric 标签，
 *   仅补齐缺失字段：文件自带标签（如 QQ 解密文件的原容器标签）优先保留。
 * - 任务持久化到 userData/download_tasks.json（含整条 MusicItem 以便重启恢复）。
 */
import { app } from 'electron'
import { join } from 'node:path'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
  createWriteStream,
  unlinkSync,
  openSync,
  readSync,
  closeSync,
  statSync
} from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import type {
  AddDownloadInput,
  DownloadTask,
  Lyric,
  MediaInfoResult,
  MusicItem,
  MusicSource,
  QualityId
} from '@common'
import {
  QUALITY_IDS,
  QUALITY_NAMES,
  blockedQualityIds,
  qualityFallbackOrder,
  qualityUpgradeOrder
} from '@common'
import { getSettings } from '../../store/settings'
import { resolveMediaInfo } from '../../providers/getUrl'
import { getProvider } from '../../providers'
import { decryptAudioFile } from '../../crypto/decryptor'
import { fillAudioTags, sniffImageMime } from '../../tag'
import { requestBuffer, requestRaw } from '../../net/request'
import { appDataPath } from '../../core/paths'
import { buildLyrics, encodeLyric } from './lyric'

const MP3_QUALITY_IDS = new Set(['128', '320', '128k', '320k', 'mp3'])
const PROGRESS_INTERVAL_MS = 500

// —— 运行时状态 ——
const tasks = new Map<string, DownloadTask>()
/** taskKey -> 整条 MusicItem（用于解析播放地址、重启恢复） */
const songCache = new Map<string, MusicItem>()
/** 正在下载的 taskKey -> AbortController（暂停/取消用） */
const activeControllers = new Map<string, AbortController>()
/** 整专封面已写入的子目录（first-write-wins，避免并发重复写） */
const albumCoverDirs = new Set<string>()

let changeListener: (() => void) | null = null
export function onDownloadChange(cb: () => void): void {
  changeListener = cb
}
function notify(): void {
  changeListener?.()
}

let saveTimer: NodeJS.Timeout | null = null

function tasksFile(): string {
  return appDataPath('download_tasks.json')
}

function defaultDownloadDir(): string {
  const configured = getSettings().download.path
  if (configured) return configured
  return join(app.getPath('music'), 'KUNYIN')
}

function extFor(qualityId: string): string {
  return MP3_QUALITY_IDS.has(qualityId) ? '.mp3' : '.flac'
}

function sanitize(s: string): string {
  return s.replace(/[\\/:*?"<>|]/g, '_')
}

function buildFileName(task: DownloadTask): string {
  const s = getSettings().download
  let base: string
  switch (s.namingStyle) {
    case 'title-artist':
      base = `${sanitize(task.title)} - ${sanitize(task.artist)}`
      break
    case 'title-only':
      base = sanitize(task.title)
      break
    default:
      base = `${sanitize(task.artist)} - ${sanitize(task.title)}`
  }
  // trackNumber 仅整专/批量专辑下载时 >0，故此前缀等价于「整专文件名带曲目号」
  if (s.trackNumberPrefix && task.trackNumber > 0) {
    return `${String(task.trackNumber).padStart(2, '0')}.${base}`
  }
  return base
}

/** 嗅探音频真实容器扩展名（QQ mflac 解密后可能是 Ogg），无法识别返回 null。 */
function sniffAudioExtension(filePath: string): string | null {
  try {
    const fd = openSync(filePath, 'r')
    const header = Buffer.alloc(12)
    const read = readSync(fd, header, 0, 12, 0)
    closeSync(fd)
    if (read < 4) return null
    if (header[0] === 0x4f && header[1] === 0x67 && header[2] === 0x67 && header[3] === 0x53)
      return '.ogg' // OggS
    if (header[0] === 0x66 && header[1] === 0x4c && header[2] === 0x61 && header[3] === 0x43)
      return '.flac' // fLaC
    if (
      (header[0] === 0x49 && header[1] === 0x44 && header[2] === 0x33) || // ID3
      (header[0] === 0xff && (header[1] & 0xe0) === 0xe0) // MPEG sync
    )
      return '.mp3'
    return null
  } catch {
    return null
  }
}

function sniffImageExt(data: Buffer): string {
  return data.length > 8 && data[0] === 0x89 && data[1] === 0x50 ? '.png' : '.jpg'
}

/** 采样率/位深标记（仅 FLAC 有效，从文件头读 STREAMINFO）。失败返回 null。 */
function flacQualityTag(filePath: string): string | null {
  try {
    const fd = openSync(filePath, 'r')
    const buf = Buffer.alloc(42)
    const n = readSync(fd, buf, 0, 42, 0)
    closeSync(fd)
    if (n < 42) return null
    if (buf.toString('latin1', 0, 4) !== 'fLaC') return null
    // METADATA_BLOCK_STREAMINFO：跳过 4B magic + 4B block header，STREAMINFO 体从 8 开始。
    // sampleRate 20 bit 起于体偏移 10（即绝对 18），bitsPerSample 紧随。
    const b = buf
    const sampleRate = ((b[18] << 12) | (b[19] << 4) | (b[20] >> 4)) & 0xfffff
    const bitsPerSample = (((b[20] & 0x01) << 4) | (b[21] >> 4)) + 1
    if (sampleRate <= 0) return null
    const khz = (sampleRate / 1000).toFixed(1).replace(/\.0$/, '')
    return `[${bitsPerSample}Bit-${khz}kHz]`
  } catch {
    return null
  }
}

// —— 任务表操作 ——
function upsertTask(task: DownloadTask): void {
  tasks.set(task.taskKey, task)
}
function patchTask(taskKey: string, patch: Partial<DownloadTask>): void {
  const t = tasks.get(taskKey)
  if (!t) return
  tasks.set(taskKey, { ...t, ...patch })
}

export function listTasks(): DownloadTask[] {
  return [...tasks.values()]
}

/** 当前设置下被屏蔽的音质档（AI 音质），下载全程跳过。 */
function blockedQualities(): readonly string[] {
  return blockedQualityIds(getSettings())
}

/**
 * 选音质：以「指定档 →（无则）设置里的优先下载音质」为目标，先按档位向下降级，
 * 目标档及更低档都没有时才向上取最接近的可用档。
 * 绝不直接跳到该曲最高档——否则整专下载选 HiRes 时，没有 HiRes 的曲子会被抓成全景声 2.0。
 */
function pickQuality(item: MusicItem, preferred?: string): string | undefined {
  const blocked = blockedQualities()
  const target = preferred || getSettings().download.preferredQuality
  const down = qualityFallbackOrder(target, item.qualities, blocked)
  if (down.length) return down[0]
  const up = qualityUpgradeOrder(target, item.qualities, blocked)
  if (up.length) return up[0]
  // 非标准档位键（各源自定义）兜底
  const standard = QUALITY_IDS as readonly string[]
  const keys = Object.keys(item.qualities).filter(
    (k) => !blocked.includes(k) && !standard.includes(k)
  )
  return keys.length ? keys[0] : undefined
}

/**
 * 解析下载地址并自动降级：优先给定档，失败按档位从高到低逐级回退到更低可用档。
 * 返回实际命中档与解析结果；全部失败时返回 rejectReason 汇总的失败结果。
 */
async function resolveWithFallback(
  song: MusicItem,
  qualityId: string
): Promise<{ qualityId: string; info: MediaInfoResult }> {
  const blocked = blockedQualities()
  const order = qualityFallbackOrder(qualityId, song.qualities, blocked)
  // 目标档及更低档全无可用档时（如该曲只有 HiRes 而任务档为 FLAC），向上取最接近的
  if (!order.length) order.push(...qualityUpgradeOrder(qualityId, song.qualities, blocked))
  let lastReason = '获取播放链接失败'
  for (const q of order) {
    const info = await resolveMediaInfo(song, q)
    if (info.isSuccess && info.playUrl) return { qualityId: q, info }
    lastReason = info.rejectReason ?? lastReason
  }
  // 换源下载：主源全部档位失败后，跨源搜索同名歌曲（对齐 lx download.isUseOtherSource）
  if (getSettings().download.useOtherSource) {
    const alt = await resolveAlternative(song, qualityId)
    if (alt) return alt
  }
  return {
    qualityId,
    info: {
      source: song.type,
      playUrl: '',
      expire: 0,
      isSuccess: false,
      quality: qualityId,
      rejectReason: lastReason
    }
  }
}

/** 跨源换源的尝试顺序（排除原源）。 */
const ALT_SOURCES: MusicSource[] = ['wy', 'kg', 'kw', 'qq', 'qqc', 'joox']

/** 归一化标题用于同名匹配（忽略大小写、空白与常见标点）。 */
function normalizeTitle(s: string): string {
  return s.toLowerCase().replace(/[\s()（）【】\-—_·,.，。'"'""?!:：;；]/g, '')
}

/** 换源下载：按「歌名 歌手」搜其它音源，取第一个同名命中，解析其可用音质的播放地址。 */
async function resolveAlternative(
  song: MusicItem,
  qualityId: string
): Promise<{ qualityId: string; info: MediaInfoResult } | null> {
  const target = normalizeTitle(song.title)
  const keyword = `${song.title} ${song.artist}`.trim()
  if (!target || !keyword) return null

  for (const src of ALT_SOURCES) {
    if (src === song.type) continue
    const provider = getProvider(src)
    if (!provider) continue
    try {
      const res = await provider.search(keyword, 0, 10)
      const match = res.result.find((i) => normalizeTitle(i.title) === target)
      if (!match) continue
      const q = pickQuality(match, qualityId)
      if (!q) continue
      const info = await resolveMediaInfo(match, q)
      if (info.isSuccess && info.playUrl) return { qualityId: q, info }
    } catch {
      /* 换源失败继续试下一个源 */
    }
  }
  return null
}

export function addTask(input: AddDownloadInput): void {
  // 下载功能总开关（对齐 lx download.enable）
  if (!getSettings().download.enabled) return
  const { item, subDir = '', listName = '', trackNumber = 0 } = input
  const isMv = !!input.mvQuality
  const qualityId = isMv ? `mv_${input.mvQuality}` : pickQuality(item, input.qualityId)
  if (!qualityId) {
    // 该曲只剩被屏蔽的 AI 音质版本：记一条失败任务说明原因，别让用户点了下载毫无反应
    if (!isMv && onlyBlockedQualities(item)) {
      const target = input.qualityId || getSettings().download.preferredQuality
      addBlockedTask(item, target, subDir, listName, trackNumber)
    }
    return
  }
  const source = item.type
  const taskKey = `${source}_${item.id}_${qualityId}`

  const existing = tasks.get(taskKey)
  if (existing) {
    if (
      existing.status === 'waiting' ||
      existing.status === 'downloading' ||
      existing.status === 'paused'
    )
      return
    // completed/failed：允许重下，清掉旧记录
    tasks.delete(taskKey)
  }

  songCache.set(taskKey, item)
  const q = isMv ? undefined : item.qualities[qualityId]
  upsertTask({
    taskKey,
    songId: item.id,
    source,
    title: item.title,
    artist: item.artist,
    album: item.album,
    cover: item.cover,
    qualityId,
    qualityName: isMv ? `MV ${input.mvQuality}` : (q?.name ?? qualityId),
    status: 'waiting',
    progress: 0,
    speedBytesPerSec: 0,
    downloadedBytes: 0,
    totalBytes: q?.filesize ?? 0,
    filePath: '',
    errorMessage: '',
    subDir,
    listName,
    trackNumber
  })
  saveTasks()
  notify()
  scheduleNext()
}

/** 该曲可用档位是否已被「屏蔽 AI 音质」全部挡下（无档可下）。 */
function onlyBlockedQualities(item: MusicItem): boolean {
  const blocked = blockedQualities()
  if (!blocked.length) return false
  const keys = Object.keys(item.qualities)
  return keys.length > 0 && keys.every((k) => blocked.includes(k))
}

/**
 * 记一条「仅剩 AI 音质版本」的失败任务，让用户在下载列表里看得到跳过原因。
 * 任务本身按原目标档登记：用户若改主意关掉屏蔽，直接点重试即可下到该版本。
 */
function addBlockedTask(
  item: MusicItem,
  target: string,
  subDir: string,
  listName: string,
  trackNumber: number
): void {
  const taskKey = `${item.type}_${item.id}_${target}`
  const existing = tasks.get(taskKey)
  if (existing && existing.status !== 'failed') return
  songCache.set(taskKey, item)
  upsertTask({
    taskKey,
    songId: item.id,
    source: item.type,
    title: item.title,
    artist: item.artist,
    album: item.album,
    cover: item.cover,
    qualityId: target,
    qualityName: QUALITY_NAMES[target as QualityId] ?? target,
    status: 'failed',
    progress: 0,
    speedBytesPerSec: 0,
    downloadedBytes: 0,
    totalBytes: 0,
    filePath: '',
    errorMessage: '该曲仅提供 AI 音质版本，已按设置屏蔽',
    subDir,
    listName,
    trackNumber
  })
  saveTasks()
  notify()
}

function runningCount(): number {
  return [...tasks.values()].filter((t) => t.status === 'downloading').length
}
function scheduleNext(): void {
  const max = Math.max(1, getSettings().download.maxConcurrent)
  for (const task of tasks.values()) {
    if (runningCount() >= max) break
    if (task.status !== 'waiting') continue
    if (activeControllers.has(task.taskKey)) continue
    void executeDownload(task.taskKey)
  }
}

async function executeDownload(taskKey: string): Promise<void> {
  const task = tasks.get(taskKey)
  const song = songCache.get(taskKey)
  if (!task) return
  if (!song) {
    patchTask(taskKey, { status: 'failed', errorMessage: '歌曲信息丢失，请删除后重新添加' })
    saveTasks()
    notify()
    return
  }

  const controller = new AbortController()
  activeControllers.set(taskKey, controller)
  patchTask(taskKey, { status: 'downloading', progress: 0 })
  notify()

  // MV 分支（对应 Android executeVideoDownload）：直链下 .mp4，不解密、不写标签。
  if (task.qualityId.startsWith('mv_')) {
    try {
      await executeVideoDownload(task, song, controller)
    } catch (e) {
      if (!controller.signal.aborted) {
        patchTask(taskKey, {
          status: 'failed',
          speedBytesPerSec: 0,
          errorMessage: e instanceof Error ? e.message : 'MV 下载失败'
        })
        saveTasks()
        notify()
      }
    } finally {
      activeControllers.delete(taskKey)
      scheduleNext()
    }
    return
  }

  try {
    const { qualityId: actualQuality, info } = await resolveWithFallback(song, task.qualityId)
    if (!info.isSuccess || !info.playUrl) {
      throw new Error(info.rejectReason ?? '获取播放链接失败')
    }
    // 自动降级成功：把展示档位与预估大小切到实际下载档。
    // task.qualityId 保留用户原始选择（taskKey 稳定），重试时仍从原档重新降级。
    let totalBytes = task.totalBytes
    if (actualQuality !== task.qualityId) {
      const q = song.qualities[actualQuality]
      totalBytes = q?.filesize ?? 0
      patchTask(taskKey, { qualityName: q?.name ?? actualQuality, totalBytes })
    }
    const ekey =
      info.encryptionInfo?.isEncrypt && info.encryptionInfo.ekey ? info.encryptionInfo.ekey : null

    const s = getSettings().download
    let dir = defaultDownloadDir()
    // 整专下载：存到「下载目录/专辑名/」（专辑名过滤非法路径字符）
    if (task.subDir) dir = join(dir, sanitize(task.subDir))
    else if (s.groupByListName && task.listName) dir = join(dir, sanitize(task.listName))
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

    let baseName = buildFileName(task)
    const ext = extFor(actualQuality)
    let fileName = `${baseName}${ext}`
    let finalPath = join(dir, fileName)

    // 跳过已存在文件（对齐 lx download.skipExistFile：>100 字节视为有效文件，直接视为完成）
    if (s.skipExistFile && existsSync(finalPath)) {
      try {
        if (statSync(finalPath).size > 100) {
          patchTask(taskKey, {
            status: 'completed',
            progress: 1,
            speedBytesPerSec: 0,
            filePath: finalPath
          })
          saveTasks()
          notify()
          return
        }
      } catch {
        /* 无权限/已删除等按不存在处理，继续下载 */
      }
    }

    const tmpPath = `${finalPath}.tmp`

    // 同名处理：非覆盖则追加序号
    if (!s.overwriteExisting) {
      let suffix = 1
      while (existsSync(finalPath)) {
        suffix++
        fileName = `${baseName} (${suffix})${ext}`
        finalPath = join(dir, fileName)
      }
    }
    if (existsSync(tmpPath)) unlinkSync(tmpPath)

    // 流式下载到 .tmp（支持刷新一次播放链接重试）
    await downloadToFile(taskKey, info.playUrl, tmpPath, totalBytes, controller.signal, () =>
      resolveMediaInfo(song, actualQuality)
    )

    // .tmp → 最终文件
    if (existsSync(finalPath)) unlinkSync(finalPath)
    renameSync(tmpPath, finalPath)

    // 加密流：原地解密 + 容器嗅探修正扩展名
    if (ekey) {
      await decryptAudioFile(finalPath, ekey)
      const actualExt = sniffAudioExtension(finalPath)
      if (actualExt && !finalPath.toLowerCase().endsWith(actualExt)) {
        const renamed = join(dir, `${baseName}${actualExt}`)
        if (existsSync(renamed)) unlinkSync(renamed)
        renameSync(finalPath, renamed)
        finalPath = renamed
        fileName = `${baseName}${actualExt}`
      }
    }

    // 采样率/位深标记（仅无损）
    if (s.appendQualityTag) {
      const tag = flacQualityTag(finalPath)
      if (tag && !baseName.endsWith(tag)) {
        const curExt = finalPath.slice(finalPath.lastIndexOf('.'))
        const renamed = join(dir, `${baseName} ${tag}${curExt}`)
        if (existsSync(renamed)) unlinkSync(renamed)
        renameSync(finalPath, renamed)
        finalPath = renamed
        baseName = `${baseName} ${tag}`
      }
    }

    // 歌词（写入内嵌标签或保存 .lrc 时获取；失败非致命）
    const needLyricMeta = s.embedLyric
    const needLrcFile = s.saveLrcFile
    let lyric: Lyric | null = null
    if (needLyricMeta || needLrcFile) {
      try {
        lyric = await getSongLyric(song)
      } catch {
        /* 歌词失败不影响下载 */
      }
    }

    // 封面字节（内嵌标签与整专封面文件复用，避免重复下载；失败非致命）
    const needCover = s.embedCover || (s.saveAlbumCover && !!task.subDir)
    let coverBytes: Buffer | null = null
    if (task.cover && needCover) {
      try {
        const bytes = await requestBuffer(task.cover)
        if (bytes.length) coverBytes = bytes
      } catch {
        coverBytes = null
      }
    }

    // 内嵌歌词文本（主歌词 + 可选翻译/罗马音/逐字；空时回退主歌词/逐字）
    const embedLyricText =
      needLyricMeta && lyric
        ? buildLyrics(lyric, s.embedLyricLx, s.embedLyricT, s.embedLyricR).trim() ||
          lyric.lrc ||
          lyric.char
        : ''

    // 内嵌标签写入：文件自带标签优先（QQ 解密文件的原容器标签更准），仅补齐缺失字段
    try {
      await fillAudioTags(finalPath, {
        title: task.title,
        artist: task.artist,
        album: task.album,
        ...(task.trackNumber > 0 ? { trackNumber: task.trackNumber } : {}),
        ...(needCover && coverBytes
          ? { pictureData: coverBytes, pictureMimeType: sniffImageMime(coverBytes) }
          : {}),
        ...(embedLyricText ? { lyrics: embedLyricText } : {})
      })
    } catch (e) {
      console.warn(`[download] 标签写入失败（非致命）: ${finalPath}`, e)
    }

    // 保存 .lrc 歌词文件（按设置的编码 utf8/gbk 写出）
    if (needLrcFile && lyric) {
      const lrcText =
        buildLyrics(lyric, s.saveLrcLx, s.saveLrcT, s.saveLrcR).trim() || lyric.lrc || lyric.char
      if (lrcText) {
        try {
          writeFileSync(join(dir, `${baseName}.lrc`), encodeLyric(lrcText, s.lrcFormat))
        } catch {
          /* ignore */
        }
      }
    }

    // 整专封面 first-write-wins（复用已取回的封面字节）
    if (s.saveAlbumCover && task.subDir && coverBytes) {
      if (!albumCoverDirs.has(task.subDir)) {
        albumCoverDirs.add(task.subDir)
        try {
          writeFileSync(join(dir, `cover${sniffImageExt(coverBytes)}`), coverBytes)
        } catch {
          albumCoverDirs.delete(task.subDir)
        }
      }
    }

    patchTask(taskKey, {
      status: 'completed',
      progress: 1,
      speedBytesPerSec: 0,
      filePath: finalPath
    })
    saveTasks()
    notify()
  } catch (e) {
    if (controller.signal.aborted) {
      // 暂停/取消导致的中断，不标记为失败（状态已由 pause/cancel 设定）
    } else {
      patchTask(taskKey, {
        status: 'failed',
        speedBytesPerSec: 0,
        errorMessage: e instanceof Error ? e.message : '下载失败'
      })
      saveTasks()
      notify()
    }
  } finally {
    activeControllers.delete(taskKey)
    scheduleNext()
  }
}

/** MV 下载（对应 Android executeVideoDownload）：getMvUrl 取直链 → 下 .mp4，无解密无标签。 */
async function executeVideoDownload(
  task: DownloadTask,
  song: MusicItem,
  controller: AbortController
): Promise<void> {
  const quality = task.qualityId.slice('mv_'.length)
  const provider = getProvider(song.type)
  if (!provider) throw new Error('音源不支持 MV')
  const mv = await provider.getMvUrl(song, quality)
  if (!mv.playUrl) throw new Error(mv.rejectReason ?? '获取 MV 地址失败')

  const dir = task.subDir ? join(defaultDownloadDir(), task.subDir) : defaultDownloadDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  const baseName = buildFileName(task)
  let fileName = `${baseName}.mp4`
  let finalPath = join(dir, fileName)
  if (!getSettings().download.overwriteExisting) {
    let suffix = 1
    while (existsSync(finalPath)) {
      suffix++
      fileName = `${baseName} (${suffix}).mp4`
      finalPath = join(dir, fileName)
    }
  }
  const tmpPath = `${finalPath}.tmp`
  if (existsSync(tmpPath)) unlinkSync(tmpPath)

  await downloadToFile(
    task.taskKey,
    mv.playUrl,
    tmpPath,
    task.totalBytes,
    controller.signal,
    async () => {
      const r = await provider.getMvUrl(song, quality)
      return { playUrl: r.playUrl ?? '', isSuccess: !!r.playUrl }
    }
  )

  if (existsSync(finalPath)) unlinkSync(finalPath)
  renameSync(tmpPath, finalPath)

  patchTask(task.taskKey, {
    status: 'completed',
    progress: 1,
    speedBytesPerSec: 0,
    filePath: finalPath
  })
  saveTasks()
  notify()
}

/** 流式下载到 path，HTTP 失败时刷新一次链接重试。进度节流写入。 */
async function downloadToFile(
  taskKey: string,
  url: string,
  path: string,
  fallbackTotal: number,
  signal: AbortSignal,
  refresh: () => Promise<{ playUrl: string; isSuccess: boolean }>
): Promise<void> {
  let resp = await requestRaw(url, { timeout: 60000 })
  if (!resp.ok) {
    const refreshed = await refresh()
    if (refreshed.isSuccess && refreshed.playUrl)
      resp = await requestRaw(refreshed.playUrl, { timeout: 60000 })
  }
  if (!resp.ok || !resp.body) throw new Error(`HTTP ${resp.status}`)

  const cl = Number(resp.headers.get('content-length')) || fallbackTotal
  if (cl > 0) patchTask(taskKey, { totalBytes: cl })

  let downloaded = 0
  let lastTick = Date.now()
  let lastBytes = 0
  const ws = createWriteStream(path)
  // Web ReadableStream → Node Readable
  const nodeStream = Readable.fromWeb(resp.body as Parameters<typeof Readable.fromWeb>[0])
  nodeStream.on('data', (chunk: Buffer) => {
    downloaded += chunk.length
    const now = Date.now()
    if (now - lastTick >= PROGRESS_INTERVAL_MS) {
      const speed = Math.round(((downloaded - lastBytes) * 1000) / (now - lastTick))
      patchTask(taskKey, {
        progress: cl > 0 ? Math.min(1, downloaded / cl) : 0,
        speedBytesPerSec: speed,
        downloadedBytes: downloaded
      })
      notify()
      lastTick = now
      lastBytes = downloaded
    }
  })
  await pipeline(nodeStream, ws, { signal })
  patchTask(taskKey, { progress: 1, downloadedBytes: downloaded, speedBytesPerSec: 0 })
}

/** 取歌词（供内嵌标签 / .lrc 文件）。走 Provider.getLyric，全空返回 null。 */
async function getSongLyric(item: MusicItem): Promise<Lyric | null> {
  const { getProvider } = await import('../../providers')
  const lyric = await getProvider(item.type)?.getLyric(item)
  if (!lyric) return null
  if (!lyric.lrc && !lyric.trans && !lyric.roma && !lyric.char && !lyric.chroma && !lyric.phonetic)
    return null
  return lyric
}

// —— 队列控制 ——
export function pauseTask(taskKey: string): void {
  activeControllers.get(taskKey)?.abort()
  activeControllers.delete(taskKey)
  const t = tasks.get(taskKey)
  if (t && (t.status === 'downloading' || t.status === 'waiting')) {
    patchTask(taskKey, { status: 'paused', speedBytesPerSec: 0 })
    saveTasks()
    notify()
  }
  scheduleNext()
}

export function resumeTask(taskKey: string): void {
  const t = tasks.get(taskKey)
  if (t && t.status === 'paused') {
    patchTask(taskKey, { status: 'waiting', progress: 0, downloadedBytes: 0 })
    saveTasks()
    notify()
    scheduleNext()
  }
}

export function retryTask(taskKey: string): void {
  const t = tasks.get(taskKey)
  if (t && t.status === 'failed') {
    patchTask(taskKey, { status: 'waiting', progress: 0, downloadedBytes: 0, errorMessage: '' })
    saveTasks()
    notify()
    scheduleNext()
  }
}

export function removeTask(taskKey: string, deleteFile = false): void {
  activeControllers.get(taskKey)?.abort()
  activeControllers.delete(taskKey)
  const t = tasks.get(taskKey)
  if (t && deleteFile && t.filePath && existsSync(t.filePath)) {
    try {
      unlinkSync(t.filePath)
    } catch {
      /* ignore */
    }
  }
  tasks.delete(taskKey)
  songCache.delete(taskKey)
  saveTasks()
  notify()
}

export function clearCompleted(): void {
  for (const [key, t] of tasks) {
    if (t.status === 'completed') {
      tasks.delete(key)
      songCache.delete(key)
    }
  }
  saveTasks()
  notify()
}

// —— 持久化（防抖 500ms，含整条 MusicItem 以便重启恢复）——
interface PersistedTask {
  task: DownloadTask
  songJson: string
}

function saveTasks(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try {
      const persisted: PersistedTask[] = [...tasks.values()].map((task) => ({
        task,
        songJson: JSON.stringify(songCache.get(task.taskKey) ?? null)
      }))
      const path = tasksFile()
      const tmp = `${path}.tmp`
      writeFileSync(tmp, JSON.stringify(persisted), 'utf-8')
      renameSync(tmp, path)
    } catch {
      /* ignore */
    }
  }, 500)
}

/** 启动时载入（DOWNLOADING 恢复为 WAITING），并继续等待中的任务。 */
export function loadTasks(): void {
  try {
    const path = tasksFile()
    if (!existsSync(path)) return
    const raw = readFileSync(path, 'utf-8')
    if (!raw.trim()) return
    const persisted = JSON.parse(raw) as PersistedTask[]
    for (const p of persisted) {
      const t = p.task
      // 中断的下载重启后重新开始
      if (t.status === 'downloading') {
        t.status = 'waiting'
        t.progress = 0
        t.downloadedBytes = 0
      }
      tasks.set(t.taskKey, t)
      if (p.songJson && p.songJson !== 'null') {
        try {
          songCache.set(t.taskKey, JSON.parse(p.songJson) as MusicItem)
        } catch {
          /* skip */
        }
      }
    }
    notify()
    scheduleNext()
  } catch {
    /* ignore */
  }
}

/** 校验任务文件仍存在（清理已被外部删除的 completed 任务的 filePath 展示）。 */
export function verifyCompletedFiles(): void {
  let changed = false
  for (const [key, t] of tasks) {
    if (t.status === 'completed' && t.filePath && !existsSync(t.filePath)) {
      try {
        statSync(t.filePath)
      } catch {
        tasks.set(key, { ...t, filePath: '' })
        changed = true
      }
    }
  }
  if (changed) notify()
}
