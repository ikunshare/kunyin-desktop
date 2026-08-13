/**
 * MP3 ID3v2.3 标签读写（1:1 移植自 Android utils/tag/mp3/Mp3Processor.kt）。
 *
 * 读：解析头部 ID3v2 帧（TIT2/TPE1/TALB/TRCK/USLT/APIC）。
 * 写：重建整份 ID3v2.3 标签写到临时文件，跳过原文件既有 ID3 标签后复制音频数据，
 *     再原子替换。仅写 UTF-16LE(BOM) 文本帧，与 Android 输出一致。
 */
import { createReadStream, createWriteStream } from 'node:fs'
import { copyFile, open, rename, unlink } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import type { MusicMeta } from './meta'
import { parseImageFile } from './image'

// —— 读 ——

export async function readMp3(filePath: string): Promise<MusicMeta | null> {
  const fh = await open(filePath, 'r')
  try {
    const header = Buffer.alloc(10)
    const read = (await fh.read(header, 0, 10, 0)).bytesRead
    if (read < 10 || header[0] !== 0x49 || header[1] !== 0x44 || header[2] !== 0x33) return null
    const tagSize = synchsafeToInt(header, 6)
    const tagData = Buffer.alloc(tagSize)
    let total = 0
    while (total < tagSize) {
      const { bytesRead } = await fh.read(tagData, total, tagSize - total, 10 + total)
      if (bytesRead <= 0) break
      total += bytesRead
    }
    return parseFrames(tagData.subarray(0, total))
  } catch {
    return null
  } finally {
    await fh.close()
  }
}

function parseFrames(data: Buffer): MusicMeta {
  const meta: MusicMeta = {}
  let offset = 0
  while (offset + 10 <= data.length) {
    const frameId = data.toString('latin1', offset, offset + 4)
    if (frameId.charCodeAt(0) === 0) break
    const frameSize = data.readUInt32BE(offset + 4)
    offset += 10
    if (frameSize <= 0 || offset + frameSize > data.length) break
    const frameData = data.subarray(offset, offset + frameSize)
    offset += frameSize
    switch (frameId) {
      case 'TIT2':
        meta.title = decodeTextFrame(frameData) ?? undefined
        break
      case 'TPE1':
        meta.artist = decodeTextFrame(frameData) ?? undefined
        break
      case 'TALB':
        meta.album = decodeTextFrame(frameData) ?? undefined
        break
      case 'TRCK':
        meta.trackNumber = Number.parseInt(decodeTextFrame(frameData)?.split('/')[0]?.trim() ?? '')
        if (Number.isNaN(meta.trackNumber)) delete meta.trackNumber
        break
      case 'USLT':
        meta.lyrics = decodeUsltFrame(frameData) ?? undefined
        break
      case 'APIC':
        decodeApicFrame(frameData, meta)
        break
    }
  }
  return meta
}

function decodeTextFrame(data: Buffer): string | null {
  if (data.length === 0) return null
  return decodeString(data.subarray(1), data[0])
}

function decodeUsltFrame(data: Buffer): string | null {
  if (data.length < 5) return null
  const encoding = data[0]
  let offset = 4 // skip language (3 bytes)
  offset = skipNullTerminated(data, offset, encoding)
  if (offset >= data.length) return null
  return decodeString(data.subarray(offset), encoding)
}

function decodeApicFrame(data: Buffer, meta: MusicMeta): void {
  if (data.length < 4) return
  const encoding = data[0]
  let offset = 1
  const mimeEnd = data.indexOf(0, offset)
  if (mimeEnd < 0) return
  const mimeType = data.toString('latin1', offset, mimeEnd)
  offset = mimeEnd + 1
  if (offset >= data.length) return
  const pictureType = data[offset]
  offset++
  offset = skipNullTerminated(data, offset, encoding)
  if (offset >= data.length) return
  if (pictureType === 3 || meta.pictureData == null) {
    meta.pictureData = Buffer.from(data.subarray(offset))
    meta.pictureMimeType = mimeType
  }
}

/** 编码 1(UTF-16)/2(UTF-16BE) 的 null 终止是双零字节，其余是单零字节。 */
function skipNullTerminated(data: Buffer, start: number, encoding: number): number {
  if (encoding === 1 || encoding === 2) {
    let i = start
    while (i + 1 < data.length) {
      if (data[i] === 0 && data[i + 1] === 0) return i + 2
      i += 2
    }
    return data.length
  }
  let i = start
  while (i < data.length) {
    if (data[i] === 0) return i + 1
    i++
  }
  return data.length
}

function decodeString(data: Buffer, encoding: number): string {
  let text: string
  switch (encoding) {
    case 0:
      text = data.toString('latin1')
      break
    case 1:
      text = decodeUtf16WithBom(data)
      break
    case 2: {
      const swapped = Buffer.from(data)
      swapped.swap16()
      text = swapped.toString('utf16le')
      break
    }
    case 3:
      text = data.toString('utf8')
      break
    default:
      text = data.toString('latin1')
  }
  // 等价 Kotlin trimEnd('\u0000')：去掉尾部 null
  let end = text.length
  while (end > 0 && text.charCodeAt(end - 1) === 0) end--
  return text.slice(0, end)
}

function decodeUtf16WithBom(data: Buffer): string {
  if (data.length < 2) return ''
  if (data[0] === 0xff && data[1] === 0xfe) return data.subarray(2).toString('utf16le')
  if (data[0] === 0xfe && data[1] === 0xff) {
    const swapped = Buffer.from(data.subarray(2))
    swapped.swap16()
    return swapped.toString('utf16le')
  }
  return data.toString('utf16le')
}

// —— 写 ——

export async function writeMp3(filePath: string, meta: MusicMeta): Promise<void> {
  const tempFile = `${filePath}.tmp`
  try {
    const frames = buildFrames(meta)

    const out = createWriteStream(tempFile)
    const header = Buffer.alloc(10)
    header.write('ID3', 0, 'latin1')
    header[3] = 3
    header[4] = 0
    header[5] = 0
    toSynchsafe(frames.length, header, 6)
    out.write(header)
    out.write(frames)

    // 跳过原文件已有的 ID3v2 标签后复制音频数据
    let skipSize = 0
    try {
      const fh = await open(filePath, 'r')
      try {
        const hdr = Buffer.alloc(10)
        const { bytesRead } = await fh.read(hdr, 0, 10, 0)
        if (bytesRead === 10 && hdr[0] === 0x49 && hdr[1] === 0x44 && hdr[2] === 0x33) {
          skipSize = synchsafeToInt(hdr, 6) + 10
        }
      } finally {
        await fh.close()
      }
    } catch {
      skipSize = 0
    }
    await pipeline(createReadStream(filePath, { start: Math.max(0, skipSize) }), out)

    // 替换原文件（对应 Android：delete → rename，失败退化为复制）
    try {
      await unlink(filePath)
    } catch {
      /* ignore */
    }
    try {
      await rename(tempFile, filePath)
    } catch {
      await copyFile(tempFile, filePath)
      await unlink(tempFile).catch(() => {})
    }
  } catch (e) {
    await unlink(tempFile).catch(() => {})
    throw e
  }
}

function buildFrames(meta: MusicMeta): Buffer {
  const chunks: Buffer[] = []
  if (meta.title) chunks.push(buildTextFrame('TIT2', meta.title))
  if (meta.artist) chunks.push(buildTextFrame('TPE1', meta.artist))
  if (meta.album) chunks.push(buildTextFrame('TALB', meta.album))
  if (meta.trackNumber != null) chunks.push(buildTextFrame('TRCK', String(meta.trackNumber)))
  if (meta.lyrics) chunks.push(buildUsltFrame(meta.lyrics))
  if (meta.picture) {
    try {
      const img = parseImageFile(meta.picture)
      chunks.push(buildApicFrameFromData(img.data, img.mimeType))
    } catch {
      /* 图片读取失败忽略，不影响其它帧 */
    }
  } else if (meta.pictureData) {
    chunks.push(buildApicFrameFromData(meta.pictureData, meta.pictureMimeType ?? 'image/jpeg'))
  }
  return Buffer.concat(chunks)
}

function buildTextFrame(id: string, text: string): Buffer {
  const textBytes = Buffer.from(text, 'utf16le')
  return buildFrame(id, Buffer.concat([Buffer.from([1, 0xff, 0xfe]), textBytes]))
}

function buildUsltFrame(lyrics: string): Buffer {
  const textBytes = Buffer.from(lyrics, 'utf16le')
  // 1(encoding) + 3(lang "zho") + 2(描述 BOM) + 2(描述空终止) + 2(歌词 BOM) + text
  const body = Buffer.concat([
    Buffer.from([1, 0x7a, 0x68, 0x6f, 0xff, 0xfe, 0x00, 0x00, 0xff, 0xfe]),
    textBytes
  ])
  return buildFrame('USLT', body)
}

function buildApicFrameFromData(data: Buffer, mimeType: string): Buffer {
  const mimeBytes = Buffer.from(mimeType, 'latin1')
  // 1(encoding 0) + mime + 1(终止) + 1(图片类型 3) + 1(描述空终止) + data
  const body = Buffer.concat([Buffer.from([0]), mimeBytes, Buffer.from([0, 3, 0]), data])
  return buildFrame('APIC', body)
}

function buildFrame(id: string, body: Buffer): Buffer {
  const out = Buffer.alloc(10 + body.length)
  out.write(id, 0, 'latin1')
  out.writeUInt32BE(body.length, 4)
  // out[8..9] 标志位保持 0
  body.copy(out, 10)
  return out
}

function toSynchsafe(value: number, out: Buffer, offset: number): void {
  out[offset] = (value >>> 21) & 0x7f
  out[offset + 1] = (value >>> 14) & 0x7f
  out[offset + 2] = (value >>> 7) & 0x7f
  out[offset + 3] = value & 0x7f
}

function synchsafeToInt(data: Buffer, offset: number): number {
  return (
    ((data[offset] & 0x7f) << 21) |
    ((data[offset + 1] & 0x7f) << 14) |
    ((data[offset + 2] & 0x7f) << 7) |
    (data[offset + 3] & 0x7f)
  )
}
