/**
 * FLAC 元数据读写（1:1 移植自 Android utils/tag/flac/FlacHandler.kt + FlacProcessor.kt）。
 *
 * 写：流式重写到临时文件 —— 原位替换 VORBIS_COMMENT/PICTURE 块（无则追加在最后一块之后），
 *     其余块原样透传并维护 last 标志位，音频帧按流复制（不整文件载入内存）。
 */
import { createReadStream, createWriteStream } from 'node:fs'
import { open, rename, unlink } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
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

const MDB_TYPE_VORBIS_COMMENT = 4
const MDB_TYPE_PICTURE = 6
const VENDOR = 'reference libFLAC 1.2.1 20070917'

// —— 读 ——

export async function readFlacMeta(filePath: string): Promise<MusicMeta | null> {
  const fh = await open(filePath, 'r')
  try {
    const marker = Buffer.alloc(4)
    if ((await fh.read(marker, 0, 4, 0)).bytesRead < 4) return null
    if (marker.toString('latin1') !== 'fLaC') return null

    const meta: MusicMeta = {}
    let offset = 4
    let isLastBlock = false
    while (!isLastBlock) {
      const header = Buffer.alloc(4)
      if ((await fh.read(header, 0, 4, offset)).bytesRead < 4) break
      isLastBlock = (header[0] & 0x80) !== 0
      const type = header[0] & 0x7f
      const length = (header[1] << 16) | (header[2] << 8) | header[3]
      offset += 4
      if (type === MDB_TYPE_VORBIS_COMMENT) {
        const payload = Buffer.alloc(length)
        await readFully(fh, payload, offset)
        const vc = parseVorbisComment(payload)
        meta.title = commentValue(vc.comments, 'TITLE') ?? undefined
        meta.artist = commentValue(vc.comments, 'ARTIST') ?? undefined
        meta.album = commentValue(vc.comments, 'ALBUM') ?? undefined
        const track = Number.parseInt(commentValue(vc.comments, 'TRACKNUMBER')?.trim() ?? '')
        if (!Number.isNaN(track)) meta.trackNumber = track
        meta.lyrics = commentValue(vc.comments, 'LYRICS') ?? undefined
      } else if (type === MDB_TYPE_PICTURE) {
        const payload = Buffer.alloc(length)
        await readFully(fh, payload, offset)
        const pic = parsePictureBlock(payload)
        if (pic.pictureType === PICTURE_TYPE_FRONT_COVER) {
          meta.pictureData = pic.pictureData
          meta.pictureMimeType = pic.mimeType
        }
      }
      offset += length
    }
    return meta
  } catch {
    return null
  } finally {
    await fh.close()
  }
}

async function readFully(fh: FileHandle, buf: Buffer, position: number): Promise<void> {
  let total = 0
  while (total < buf.length) {
    const { bytesRead } = await fh.read(buf, total, buf.length - total, position + total)
    if (bytesRead <= 0) throw new Error('Unexpected EOF')
    total += bytesRead
  }
}

// —— 写 ——

/** 从图片字节构造 FLAC PICTURE 块 payload（type=3 封面） */
function buildPictureFromImage(img: {
  width: number
  height: number
  mimeType: string
  data: Buffer
}): Buffer {
  return buildPictureBlock({
    pictureType: PICTURE_TYPE_FRONT_COVER,
    mimeType: img.mimeType,
    description: '',
    width: img.width,
    height: img.height,
    bitsPerPixel: img.mimeType === 'image/png' ? 32 : 24,
    colors: 0,
    pictureData: img.data
  })
}

function resolvePicture(meta: MusicMeta): Buffer | null {
  if (meta.picture) {
    try {
      return buildPictureFromImage(parseImageFile(meta.picture))
    } catch {
      return null
    }
  }
  if (meta.pictureData) {
    return buildPictureFromImage(parseImage(meta.pictureData))
  }
  return null
}

export async function writeFlac(filePath: string, meta: MusicMeta): Promise<void> {
  const comments: string[] = []
  if (meta.title) comments.push(`TITLE=${meta.title}`)
  if (meta.artist) comments.push(`ARTIST=${meta.artist}`)
  if (meta.album) comments.push(`ALBUM=${meta.album}`)
  if (meta.trackNumber != null) comments.push(`TRACKNUMBER=${meta.trackNumber}`)
  if (meta.lyrics) comments.push(`LYRICS=${meta.lyrics}`)
  const vorbis = buildVorbisComment(VENDOR, comments)
  const picture = resolvePicture(meta)

  const tempFile = `${filePath}.lxmtemp`
  const fh = await open(filePath, 'r')
  try {
    const marker = Buffer.alloc(4)
    if ((await fh.read(marker, 0, 4, 0)).bytesRead < 4) throw new Error('Not a valid FLAC file')
    if (marker.toString('latin1') !== 'fLaC') throw new Error('Not a valid FLAC file')

    const out = createWriteStream(tempFile)
    out.write(marker)

    let offset = 4
    let tasks = 1 + (picture ? 1 : 0)
    let vorbisPending = true
    let picturePending = picture !== null
    let audioOffset = -1

    // 遍历 metadata 块；最后一个块之后是音频帧
    for (;;) {
      const header = Buffer.alloc(4)
      if ((await fh.read(header, 0, 4, offset)).bytesRead < 4) throw new Error('Unexpected EOF')
      const isLastBlock = (header[0] & 0x80) !== 0
      const type = header[0] & 0x7f
      const length = (header[1] << 16) | (header[2] << 8) | header[3]
      offset += 4

      if (type === MDB_TYPE_VORBIS_COMMENT && vorbisPending) {
        writeBlock(out, MDB_TYPE_VORBIS_COMMENT, vorbis, isLastBlock && tasks === 1)
        vorbisPending = false
        tasks--
      } else if (type === MDB_TYPE_PICTURE && picturePending) {
        writeBlock(out, MDB_TYPE_PICTURE, picture as Buffer, isLastBlock && tasks === 1)
        picturePending = false
        tasks--
      } else {
        // 原样透传：若还要在末尾追加新块，则原 last 块摘掉 last 标志
        const writeAsLast = isLastBlock && tasks === 0
        const newHeader = Buffer.alloc(4)
        newHeader[0] = type | (writeAsLast ? 0x80 : 0)
        newHeader[1] = header[1]
        newHeader[2] = header[2]
        newHeader[3] = header[3]
        out.write(newHeader)
        if (length > 0) {
          await pipeline(
            createReadStream(filePath, { start: offset, end: offset + length - 1 }),
            out,
            { end: false }
          )
        }
      }

      if (isLastBlock) {
        audioOffset = offset + length
        break
      }
      offset += length
    }

    // 原文件没有可原位替换的块 → 在最后一个块之后追加新块
    if (tasks > 0) {
      if (vorbisPending) {
        writeBlock(out, MDB_TYPE_VORBIS_COMMENT, vorbis, tasks === 1)
        vorbisPending = false
        tasks--
      }
      if (picturePending) {
        writeBlock(out, MDB_TYPE_PICTURE, picture as Buffer, tasks === 1)
        picturePending = false
        tasks--
      }
    }

    // 音频帧流式复制
    await pipeline(createReadStream(filePath, { start: audioOffset }), out)

    try {
      await unlink(filePath)
    } catch {
      /* ignore */
    }
    try {
      await rename(tempFile, filePath)
    } catch {
      throw new Error('替换 FLAC 文件失败')
    }
  } catch (e) {
    await unlink(tempFile).catch(() => {})
    throw e
  } finally {
    await fh.close()
  }
}

function writeBlock(out: Writable, type: number, payload: Buffer, isLast: boolean): void {
  const header = Buffer.alloc(4)
  header[0] = (type & 0x7f) | (isLast ? 0x80 : 0)
  header[1] = (payload.length >>> 16) & 0xff
  header[2] = (payload.length >>> 8) & 0xff
  header[3] = payload.length & 0xff
  out.write(header)
  out.write(payload)
}
