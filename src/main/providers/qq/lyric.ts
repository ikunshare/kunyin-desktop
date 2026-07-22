/**
 * QQ 歌词解码（移植自 LrcParser.parseTx + fetchLegacyLyric）。
 * 纯函数：主 lyric/trans/roma 均为 QRC 十六进制（crypt:1），各自 3DES 解密；
 * 主 lyric 与 roma 走逐字增强，trans 取解密原文（行级）。旧接口回退为 base64+HTML 反转义。
 */
import { EMPTY_LYRIC, type Lyric } from '@common'
import { decryptQrc, qrcToLrc } from '../../crypto/lyric'

/** 从 QRC 解密结果里取 LyricContent（XML 包裹）或原样返回 */
function extractLyricContent(decrypted: string): string {
  const m = /LyricContent="([\s\S]*?)"/.exec(decrypted)
  return (m ? m[1] : decrypted).trim()
}

/** 对应 LrcParser.parseTx：qrcHex/transHex/romaHex → Lyric 六字段 */
export function parseTxLyric(lyricHex?: string, transHex?: string, romaHex?: string): Lyric {
  const out: Lyric = { ...EMPTY_LYRIC }
  if (lyricHex) {
    const dec = decryptQrc(lyricHex)
    if (dec) {
      const enhanced = qrcToLrc(dec)
      if (enhanced) {
        out.lrc = enhanced
        out.char = enhanced
      } else {
        out.lrc = extractLyricContent(dec)
      }
    }
  }
  if (transHex) {
    const dec = decryptQrc(transHex)
    if (dec) out.trans = extractLyricContent(dec)
  }
  if (romaHex) {
    const dec = decryptQrc(romaHex)
    if (dec) {
      const enhanced = qrcToLrc(dec)
      if (enhanced) {
        out.roma = enhanced
        out.chroma = enhanced
      } else {
        out.roma = extractLyricContent(dec)
      }
    }
  }
  return out
}

/** 旧接口 base64 歌词解码 + HTML 实体反转义（对应 decodeLegacyLyric） */
export function decodeLegacyLyric(b64?: string): string {
  if (!b64) return ''
  try {
    return Buffer.from(b64, 'base64')
      .toString('utf-8')
      .replace(/&apos;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&#10;/g, '\n')
      .replace(/&#13;/g, '\r')
      .replace(/&#32;/g, ' ')
      .replace(/&#160;/g, ' ')
  } catch {
    return ''
  }
}

/** Lyric 是否为空（对应 Lyric.isEmpty） */
export function isLyricEmpty(l: Lyric): boolean {
  return !l.lrc && !l.trans && !l.roma && !l.char && !l.chroma && !l.phonetic
}
