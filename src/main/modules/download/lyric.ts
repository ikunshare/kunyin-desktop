/**
 * 下载流程的歌词拼装与编码（移植自 lx-music-desktop 的 renderer/worker/download/lrcTool.ts + utils.ts）。
 *
 * - buildLyrics：把主歌词按需拼接翻译 / 罗马音 / 逐字（逐字以 [awlrc:...] base64 内联）。
 * - encodeLyric：按设置的编码（utf8 / gbk）转 Buffer，带 BOM（对齐 lx 的 iconv-lite addBOM）。
 */
import iconv from 'iconv-lite'
import type { Lyric } from '@common'

const timeFieldExp = /^(?:\[[\d:.]+\])+/g
const timeExp = /\d{1,3}(:\d{1,3}){0,2}(?:\.\d{1,3})/g

const t_rxp_1 = /^0+(\d+)/
const t_rxp_2 = /:0+(\d+)/g
const t_rxp_3 = /\.0+(\d+)/
const formatTimeLabel = (label: string): string =>
  label.replace(t_rxp_1, '$1').replace(t_rxp_2, ':$1').replace(t_rxp_3, '.$1')

/** 把扩展歌词（翻译/罗马音）的时间轴对齐到主歌词已有时间点，避免多出无主歌词对应的时间行。 */
const filterExtendedLyricLabel = (lrcTimeLabels: Set<string>, extendedLyric: string): string => {
  const extendedLines = extendedLyric.split(/\r\n|\n|\r/)
  const lines: string[] = []
  for (const raw of extendedLines) {
    let line = raw.trim()
    const result = timeFieldExp.exec(line)
    if (!result) continue

    const timeField = result[0]
    const text = line.replace(timeFieldExp, '').trim()
    if (!text) continue
    const times = timeField.match(timeExp)
    if (times == null) continue

    const newTimes = times.filter((time) => lrcTimeLabels.has(formatTimeLabel(time)))
    if (newTimes.length != times.length) {
      if (!newTimes.length) continue
      line = `[${newTimes.join('][')}]${text}`
    }
    lines.push(line)
  }
  return lines.join('\n')
}

const parseLrcTimeLabel = (lrc: string): Set<string> => {
  const linesSet = new Set<string>()
  for (const raw of lrc.split(/\r\n|\n|\r/)) {
    const line = raw.trim()
    const result = timeFieldExp.exec(line)
    if (result) {
      const timeField = result[0]
      const text = line.replace(timeFieldExp, '').trim()
      if (text) {
        const times = timeField.match(timeExp)
        if (times == null) continue
        for (const time of times) linesSet.add(formatTimeLabel(time))
      }
    }
  }
  return linesSet
}

const buildAwlyric = (lrcData: Lyric): string => {
  const lrc: string[] = []
  if (lrcData.lrc) lrc.push(`lrc:${Buffer.from(lrcData.lrc.trim(), 'utf-8').toString('base64')}`)
  if (lrcData.trans)
    lrc.push(`tlrc:${Buffer.from(lrcData.trans.trim(), 'utf-8').toString('base64')}`)
  if (lrcData.roma) lrc.push(`rlrc:${Buffer.from(lrcData.roma.trim(), 'utf-8').toString('base64')}`)
  if (lrcData.char)
    lrc.push(`awlrc:${Buffer.from(lrcData.char.trim(), 'utf-8').toString('base64')}`)
  return lrc.length ? `[awlrc:${lrc.join(',')}]` : ''
}

/**
 * 拼装歌词文本。downloadAwlrc 对应逐字（char），downloadTlrc 对应翻译（trans），
 * downloadRlrc 对应罗马音（roma）。
 */
export function buildLyrics(
  lrcData: Lyric,
  downloadAwlrc: boolean,
  downloadTlrc: boolean,
  downloadRlrc: boolean
): string {
  if (!lrcData.trans && !lrcData.roma && !lrcData.char) return lrcData.lrc

  const lrcTimeLabels = parseLrcTimeLabel(lrcData.lrc)

  let lrc = lrcData.lrc
  if (downloadTlrc && lrcData.trans) {
    lrc = lrc.trim() + `\n\n${filterExtendedLyricLabel(lrcTimeLabels, lrcData.trans)}\n`
  }
  if (downloadRlrc && lrcData.roma) {
    lrc = lrc.trim() + `\n\n${filterExtendedLyricLabel(lrcTimeLabels, lrcData.roma)}\n`
  }
  if (downloadAwlrc) {
    const awlrc = buildAwlyric(lrcData)
    if (awlrc) lrc = lrc.trim() + `\n\n${awlrc}\n`
  }
  return lrc
}

/** 歌词编码（utf8 / gbk），带 BOM（对齐 lx 的 iconv-lite addBOM: true）。 */
export function encodeLyric(text: string, format: 'utf8' | 'gbk'): Buffer {
  return iconv.encode(text, format, { addBOM: true })
}
