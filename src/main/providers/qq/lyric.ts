/**
 * QQ 歌词解码（移植自 LrcParser.parseTx + fetchLegacyLyric）。
 * 纯函数：主 lyric/trans/roma 均为 QRC 十六进制（crypt:1），各自 3DES 解密；
 * 主 lyric 与 roma 走逐字增强，trans 取解密原文（行级）。旧接口回退为 base64+HTML 反转义。
 */
import { EMPTY_LYRIC, type Lyric } from '@common'
import { decryptQrc, isStandardLrc, parseTxQrc } from '../../crypto/lyric'

/**
 * 对应安卓 LrcParser.parseTx：qrcHex/transHex/romaHex → Lyric 六字段。
 * - 主 lyric：QRC 解密后走 parseTxQrc，得行级纯文本(lrc) + 逐字增强(char)；无逐字则整段当纯文本。
 * - trans：直接用解密原文（不走逐字解析，安卓即如此）。
 * - roma：解密后走 parseTxQrc → roma(行级) + chroma(逐字)；无逐字但为标准 LRC 时整段作 roma。
 */
export function parseTxLyric(lyricHex?: string, transHex?: string, romaHex?: string): Lyric {
  const out: Lyric = { ...EMPTY_LYRIC }
  if (lyricHex) {
    const dec = decryptQrc(lyricHex)
    if (dec) {
      const { lrc, char } = parseTxQrc(dec)
      if (lrc) {
        out.lrc = lrc
        out.char = char
      } else {
        // QRC 解析无结果：整段当标准 LRC / 纯文本
        out.lrc = dec
      }
    }
  }
  if (transHex) {
    const dec = decryptQrc(transHex)
    if (dec) out.trans = dec
  }
  if (romaHex) {
    const dec = decryptQrc(romaHex)
    if (dec) {
      const { lrc, char } = parseTxQrc(dec)
      if (lrc) {
        out.roma = lrc
        out.chroma = char
      } else if (isStandardLrc(dec)) {
        out.roma = dec
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
