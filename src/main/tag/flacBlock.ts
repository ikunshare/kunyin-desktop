/**
 * FLAC Vorbis Comment 与 PICTURE 块编解码（1:1 移植自 Android
 * utils/tag/flac/MetaDataBlockVorbisComment.kt + MetaDataBlockPicture.kt）。
 * Ogg 的评论头与之同构（METADATA_BLOCK_PICTURE 也复用 PICTURE 块格式），故放共享模块。
 */

export interface FlacPictureBlock {
  pictureType: number
  mimeType: string
  description: string
  width: number
  height: number
  bitsPerPixel: number
  colors: number
  pictureData: Buffer
}

export const PICTURE_TYPE_FRONT_COVER = 3

export interface VorbisComment {
  vendor: string
  comments: string[]
}

// —— Vorbis Comment（little-endian） ——

export function buildVorbisComment(vendor: string, comments: string[]): Buffer {
  const vendorBytes = Buffer.from(vendor, 'utf8')
  const commentBuffers = comments.map((c) => Buffer.from(c, 'utf8'))
  const total =
    4 + vendorBytes.length + 4 + commentBuffers.reduce((sum, c) => sum + 4 + c.length, 0)
  const out = Buffer.alloc(total)
  let offset = 0
  offset = out.writeUInt32LE(vendorBytes.length, offset)
  vendorBytes.copy(out, offset)
  offset += vendorBytes.length
  offset = out.writeUInt32LE(commentBuffers.length, offset)
  for (const c of commentBuffers) {
    offset = out.writeUInt32LE(c.length, offset)
    c.copy(out, offset)
    offset += c.length
  }
  return out
}

export function parseVorbisComment(data: Buffer): VorbisComment {
  let offset = 0
  const vendorLength = data.readUInt32LE(offset)
  offset += 4
  const vendor = data.toString('utf8', offset, offset + vendorLength)
  offset += vendorLength
  const commentCount = data.readUInt32LE(offset)
  offset += 4
  const comments: string[] = []
  for (let i = 0; i < commentCount; i++) {
    const len = data.readUInt32LE(offset)
    offset += 4
    comments.push(data.toString('utf8', offset, offset + len))
    offset += len
  }
  return { vendor, comments }
}

/** 从 "KEY=VALUE" 评论列表取字段（键大小写不敏感）。 */
export function commentValue(comments: string[], key: string): string | null {
  for (const comment of comments) {
    const eq = comment.indexOf('=')
    if (eq > 0 && comment.slice(0, eq).toUpperCase() === key) {
      return comment.slice(eq + 1)
    }
  }
  return null
}

// —— PICTURE 块（big-endian） ——

export function buildPictureBlock(pic: FlacPictureBlock): Buffer {
  const mimeBytes = Buffer.from(pic.mimeType, 'utf8')
  const descBytes = Buffer.from(pic.description, 'utf8')
  const out = Buffer.alloc(
    4 + 4 + mimeBytes.length + 4 + descBytes.length + 4 * 5 + pic.pictureData.length
  )
  let offset = 0
  offset = out.writeUInt32BE(pic.pictureType, offset)
  offset = out.writeUInt32BE(mimeBytes.length, offset)
  mimeBytes.copy(out, offset)
  offset += mimeBytes.length
  offset = out.writeUInt32BE(descBytes.length, offset)
  descBytes.copy(out, offset)
  offset += descBytes.length
  offset = out.writeUInt32BE(pic.width, offset)
  offset = out.writeUInt32BE(pic.height, offset)
  offset = out.writeUInt32BE(pic.bitsPerPixel, offset)
  offset = out.writeUInt32BE(pic.colors, offset)
  offset = out.writeUInt32BE(pic.pictureData.length, offset)
  pic.pictureData.copy(out, offset)
  return out
}

export function parsePictureBlock(data: Buffer): FlacPictureBlock {
  let offset = 0
  const pictureType = data.readUInt32BE(offset)
  offset += 4
  const mimeLen = data.readUInt32BE(offset)
  offset += 4
  const mimeType = data.toString('utf8', offset, offset + mimeLen)
  offset += mimeLen
  const descLen = data.readUInt32BE(offset)
  offset += 4
  const description = data.toString('utf8', offset, offset + descLen)
  offset += descLen
  const width = data.readUInt32BE(offset)
  offset += 4
  const height = data.readUInt32BE(offset)
  offset += 4
  const bitsPerPixel = data.readUInt32BE(offset)
  offset += 4
  const colors = data.readUInt32BE(offset)
  offset += 4
  const dataLen = data.readUInt32BE(offset)
  offset += 4
  const pictureData = data.subarray(offset, offset + dataLen)
  return { pictureType, mimeType, description, width, height, bitsPerPixel, colors, pictureData }
}
