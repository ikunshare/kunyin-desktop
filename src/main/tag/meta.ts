/**
 * 音频标签数据类型（1:1 移植自 Android utils/tag/MusicMeta.kt）。
 * 字段缺省（undefined）表示写入时不覆盖该项。
 */
export interface MusicMeta {
  title?: string
  artist?: string
  album?: string
  trackNumber?: number
  /** 封面图片本地文件路径（写入时读取） */
  picture?: string
  /** 歌词（增强 LRC 文本） */
  lyrics?: string
  /** 封面图片字节；优先于 picture 路径 */
  pictureData?: Buffer
  pictureMimeType?: string
}

/** 图片解析结果（移植自 utils/tag/util/ImageParser.kt） */
export interface ParsedImage {
  width: number
  height: number
  mimeType: string
  data: Buffer
}

/** 通过 magic bytes 嗅探图片 MIME（仅区分 JPEG/PNG，与 Android sniffImageMime 一致）。 */
export function sniffImageMime(data: Buffer): string {
  return data.length > 8 && data[0] === 0x89 && data[1] === 0x50 ? 'image/png' : 'image/jpeg'
}
