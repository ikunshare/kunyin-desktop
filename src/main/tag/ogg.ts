/**
 * OGG Vorbis/Opus 评论头读写（1:1 移植自 Android utils/tag/ogg/OggProcessor.kt）。
 *
 * 读：page0 判断 OpusHead 还是 Vorbis 识别头，随后拼出评论包并解 Vorbis Comment 结构。
 * 写：重建评论包（含 METADATA_BLOCK_PICTURE base64），替换原评论包所在页，
 *     后续页面序号平移并全量重算 CRC（Ogg CRC32 为非反射多项式，与 zlib.crc32 不同）。
 */
import { createWriteStream } from 'node:fs'
import { open, rename, unlink } from 'node:fs/promises'
import { finished } from 'node:stream/promises'
import type { Writable } from 'node:stream'
import type { FileHandle } from 'node:fs/promises'
import type { MusicMeta } from './meta'
import { parseImage, parseImageFile } from './image'
import {
  buildPictureBlock,
  buildVorbisComment,
  commentValue,
  parsePictureBlock,
  parseVorbisComment,
  PICTURE_TYPE_FRONT_COVER
} from './flacBlock'

interface OggPage {
  headerType: number
  granulePosition: bigint
  serialNumber: number
  pageSequenceNumber: number
  segmentTable: Buffer
  body: Buffer
}

/** 顺序读取的 Ogg 页 reader（定位读，避免维护缓冲流） */
class PageReader {
  private offset = 0
  constructor(private readonly fh: FileHandle) {}

  async readPage(): Promise<OggPage> {
    const capture = Buffer.alloc(4)
    await readFullyAt(this.fh, capture, this.offset)
    this.offset += 4
    if (capture.toString('latin1') !== 'OggS') throw new Error('Invalid OGG capture pattern')

    const fixed = Buffer.alloc(23)
    await readFullyAt(this.fh, fixed, this.offset)
    this.offset += 23
    // fixed[0] = version(已读入但 Kotlin 丢弃)，fixed[1] = headerType
    const headerType = fixed[1]
    const granulePosition = fixed.readBigUInt64LE(2)
    const serialNumber = fixed.readUInt32LE(10)
    const pageSequenceNumber = fixed.readUInt32LE(14)
    // fixed[18..21] = checksum（丢弃）
    const numSegments = fixed[22]

    const segmentTable = Buffer.alloc(numSegments)
    await readFullyAt(this.fh, segmentTable, this.offset)
    this.offset += numSegments
    let bodySize = 0
    for (const s of segmentTable) bodySize += s
    const body = Buffer.alloc(bodySize)
    await readFullyAt(this.fh, body, this.offset)
    this.offset += bodySize
    return { headerType, granulePosition, serialNumber, pageSequenceNumber, segmentTable, body }
  }
}

async function readFullyAt(fh: FileHandle, buf: Buffer, position: number): Promise<void> {
  let total = 0
  while (total < buf.length) {
    const { bytesRead } = await fh.read(buf, total, buf.length - total, position + total)
    if (bytesRead <= 0) throw new Error('Unexpected EOF')
    total += bytesRead
  }
}

// —— Ogg CRC（多项式 0x04C11DB7，非反射，init/xorout 均为 0） ——

const CRC_TABLE = new Uint32Array(256)
for (let i = 0; i < 256; i++) {
  let r = i << 24
  for (let j = 0; j < 8; j++) {
    r = (r & 0x80000000) !== 0 ? (r << 1) ^ 0x04c11db7 : r << 1
  }
  CRC_TABLE[i] = r >>> 0
}

function oggCrc(data: Buffer): number {
  let crc = 0
  for (let i = 0; i < data.length; i++) {
    crc = ((crc << 8) ^ CRC_TABLE[(((crc >>> 24) & 0xff) ^ data[i]) & 0xff]) >>> 0
  }
  return crc
}

// —— 页读写 ——

function writePage(out: Writable, page: OggPage): void {
  const headerSize = 27 + page.segmentTable.length
  const raw = Buffer.alloc(headerSize + page.body.length)
  raw.write('OggS', 0, 'latin1')
  raw[4] = 0
  raw[5] = page.headerType
  raw.writeBigUInt64LE(page.granulePosition, 6)
  raw.writeUInt32LE(page.serialNumber, 14)
  raw.writeUInt32LE(page.pageSequenceNumber, 18)
  // raw[22..25] 校验和先留 0，最后回填
  raw[26] = page.segmentTable.length
  page.segmentTable.copy(raw, 27)
  page.body.copy(raw, headerSize)
  raw.writeUInt32LE(oggCrc(raw), 22)
  out.write(raw)
}

// —— 读 ——

export async function readOggMeta(filePath: string): Promise<MusicMeta | null> {
  const fh = await open(filePath, 'r')
  try {
    const reader = new PageReader(fh)
    const page0 = await reader.readPage()
    const isOpus = page0.body.length >= 8 && page0.body.toString('latin1', 0, 8) === 'OpusHead'

    // 拼评论包：读到第一个 <255 的段即包结束
    const chunks: Buffer[] = []
    let total = 0
    for (;;) {
      const page = await reader.readPage()
      let bodyOffset = 0
      let done = false
      for (const segSize of page.segmentTable) {
        bodyOffset += segSize
        if (segSize < 255) {
          chunks.push(page.body.subarray(0, bodyOffset))
          total += bodyOffset
          done = true
          break
        }
      }
      if (done) break
      chunks.push(page.body)
      total += page.body.length
    }
    const packet = Buffer.concat(chunks, total)

    let vcData: Buffer
    if (isOpus) {
      if (packet.length < 8) return {}
      vcData = packet.subarray(8) // 去 "OpusTags"
    } else {
      if (packet.length < 7) return {}
      vcData = packet.subarray(7) // 去 0x03 + "vorbis"
    }

    const vc = parseVorbisComment(vcData)
    const meta: MusicMeta = {}
    meta.title = commentValue(vc.comments, 'TITLE') ?? undefined
    meta.artist = commentValue(vc.comments, 'ARTIST') ?? undefined
    meta.album = commentValue(vc.comments, 'ALBUM') ?? undefined
    const track = Number.parseInt(commentValue(vc.comments, 'TRACKNUMBER')?.trim() ?? '')
    if (!Number.isNaN(track)) meta.trackNumber = track
    meta.lyrics = commentValue(vc.comments, 'LYRICS') ?? undefined
    const pictureB64 = commentValue(vc.comments, 'METADATA_BLOCK_PICTURE')
    if (pictureB64) {
      try {
        const pic = parsePictureBlock(Buffer.from(pictureB64, 'base64'))
        if (pic.pictureType === PICTURE_TYPE_FRONT_COVER) {
          meta.pictureData = pic.pictureData
          meta.pictureMimeType = pic.mimeType
        }
      } catch {
        /* 图片块损坏忽略 */
      }
    }
    return meta
  } catch {
    return null
  } finally {
    await fh.close()
  }
}

// —— 写 ——

export async function writeOgg(filePath: string, meta: MusicMeta): Promise<void> {
  const tempFile = `${filePath}.oggtmp`
  const fh = await open(filePath, 'r')
  try {
    const reader = new PageReader(fh)
    const page0 = await reader.readPage()
    const isOpus = page0.body.length >= 8 && page0.body.toString('latin1', 0, 8) === 'OpusHead'

    const out = createWriteStream(tempFile)
    writePage(out, page0)

    // 消费评论包所在页，捕获其后的剩余段（同一页里的下一包开头）
    let trailingSegments: Buffer | null = null
    let trailingBody: Buffer | null = null
    let pagesConsumed = 0
    for (;;) {
      const page = await reader.readPage()
      pagesConsumed++
      let bodyOffset = 0
      let done = false
      for (let i = 0; i < page.segmentTable.length; i++) {
        const segSize = page.segmentTable[i]
        bodyOffset += segSize
        if (segSize < 255) {
          if (i + 1 < page.segmentTable.length) {
            trailingSegments = page.segmentTable.subarray(i + 1)
            trailingBody = page.body.subarray(bodyOffset)
          }
          done = true
          break
        }
      }
      if (done) break
    }

    const newPacket = buildCommentPacket(meta, isOpus)
    const commentSegments = buildSegmentTable(newPacket.length)
    const allSegments =
      trailingSegments && trailingBody
        ? Buffer.concat([commentSegments, trailingSegments])
        : commentSegments
    const allBody = trailingBody ? Buffer.concat([newPacket, trailingBody]) : newPacket

    let segOffset = 0
    let bodyOffset = 0
    let seq = 1
    while (segOffset < allSegments.length) {
      const count = Math.min(255, allSegments.length - segOffset)
      const pageSegs = allSegments.subarray(segOffset, segOffset + count)
      let pageBodySize = 0
      for (const s of pageSegs) pageBodySize += s
      const pageBody = allBody.subarray(bodyOffset, bodyOffset + pageBodySize)
      const headerType = segOffset > 0 ? 0x01 : 0x00
      writePage(out, {
        headerType,
        granulePosition: 0n,
        serialNumber: page0.serialNumber,
        pageSequenceNumber: seq,
        segmentTable: pageSegs,
        body: pageBody
      })
      segOffset += count
      bodyOffset += pageBodySize
      seq++
    }

    // 后续页面序号整体平移，CRC 由 writePage 重算
    const seqAdjust = seq - (1 + pagesConsumed)
    for (;;) {
      let page: OggPage
      try {
        page = await reader.readPage()
      } catch {
        break
      }
      writePage(out, {
        headerType: page.headerType,
        granulePosition: page.granulePosition,
        serialNumber: page.serialNumber,
        pageSequenceNumber: page.pageSequenceNumber + seqAdjust,
        segmentTable: page.segmentTable,
        body: page.body
      })
    }

    // 等写出流落盘完成后再替换原文件
    out.end()
    await finished(out)

    try {
      await unlink(filePath)
    } catch {
      /* ignore */
    }
    try {
      await rename(tempFile, filePath)
    } catch {
      throw new Error('替换 OGG 文件失败')
    }
  } catch (e) {
    await unlink(tempFile).catch(() => {})
    throw e
  } finally {
    await fh.close()
  }
}

function buildCommentPacket(meta: MusicMeta, isOpus: boolean): Buffer {
  const comments: string[] = []
  if (meta.title) comments.push(`TITLE=${meta.title}`)
  if (meta.artist) comments.push(`ARTIST=${meta.artist}`)
  if (meta.album) comments.push(`ALBUM=${meta.album}`)
  if (meta.trackNumber != null) comments.push(`TRACKNUMBER=${meta.trackNumber}`)
  if (meta.lyrics) comments.push(`LYRICS=${meta.lyrics}`)

  let img: { width: number; height: number; mimeType: string; data: Buffer } | null = null
  if (meta.picture) {
    try {
      img = parseImageFile(meta.picture)
    } catch {
      img = null
    }
  } else if (meta.pictureData) {
    img = parseImage(meta.pictureData)
  }
  if (img) {
    const picture = buildPictureBlock({
      pictureType: PICTURE_TYPE_FRONT_COVER,
      mimeType: img.mimeType,
      description: '',
      width: img.width,
      height: img.height,
      bitsPerPixel: img.mimeType === 'image/png' ? 32 : 24,
      colors: 0,
      pictureData: img.data
    })
    comments.push(`METADATA_BLOCK_PICTURE=${picture.toString('base64')}`)
  }

  const vendor = isOpus ? 'libopus' : 'Xiph.Org libVorbis I 20150105'
  const vcPayload = buildVorbisComment(vendor, comments)

  const chunks: Buffer[] = []
  if (isOpus) {
    chunks.push(Buffer.from('OpusTags', 'latin1'))
  } else {
    chunks.push(Buffer.from([0x03]))
    chunks.push(Buffer.from('vorbis', 'latin1'))
  }
  chunks.push(vcPayload)
  if (!isOpus) chunks.push(Buffer.from([0x01])) // framing bit
  return Buffer.concat(chunks)
}

function buildSegmentTable(packetSize: number): Buffer {
  const segments: number[] = []
  let remaining = packetSize
  while (remaining >= 255) {
    segments.push(255)
    remaining -= 255
  }
  segments.push(remaining)
  return Buffer.from(segments)
}
