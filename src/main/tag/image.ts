/**
 * 图片解析（1:1 移植自 Android utils/tag/util/ImageParser.kt）。
 * 仅需尺寸 + MIME 供 APIC / FLAC PICTURE 块写入，无需解码像素。
 */
import { readFileSync } from 'node:fs'
import type { ParsedImage } from './meta'

function isJpeg(d: Buffer): boolean {
  return d.length > 2 && d[0] === 0xff && d[1] === 0xd8
}

function isPng(d: Buffer): boolean {
  return d.length > 8 && d[0] === 0x89 && d[1] === 0x50
}

function parsePngSize(d: Buffer, info: { width: number; height: number }): void {
  info.width = d.readUInt32BE(16)
  info.height = d.readUInt32BE(20)
}

/** 遍历 JPEG 段找 SOF0/SOF2 取尺寸（与 Android 相同的宽松解析） */
function parseJpegSize(d: Buffer, info: { width: number; height: number }): void {
  let i = 2
  while (i < d.length - 1) {
    if (d[i] === 0xff) {
      const type = d[i + 1]
      const len = (d[i + 2] << 8) | d[i + 3]
      if (type === 0xc0 || type === 0xc2) {
        if (i + 9 < d.length) {
          info.height = (d[i + 5] << 8) | d[i + 6]
          info.width = (d[i + 7] << 8) | d[i + 8]
        }
        return
      }
      i += 2 + len
    } else {
      i++
    }
  }
}

export function parseImage(data: Buffer): ParsedImage {
  const info: ParsedImage = { width: 0, height: 0, mimeType: 'image/jpeg', data }
  if (isJpeg(data)) {
    info.mimeType = 'image/jpeg'
    parseJpegSize(data, info)
  } else if (isPng(data)) {
    info.mimeType = 'image/png'
    parsePngSize(data, info)
  } else {
    // 未知格式兜底：按 JPEG 处理，尺寸给占位（与 Android 一致）
    info.mimeType = 'image/jpeg'
    info.width = 500
    info.height = 500
  }
  return info
}

export function parseImageFile(filePath: string): ParsedImage {
  return parseImage(readFileSync(filePath))
}
