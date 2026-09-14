/**
 * 下载流程的歌词拼装与编码（移植自 lx-music-desktop 的 renderer/worker/download/lrcTool.ts + utils.ts）。
 *
 * - buildLyrics：把主歌词按需拼接翻译 / 罗马音；开启逐字时主歌词体改用增强 LRC（A2 扩展：
 *   `[mm:ss.xxx]<mm:ss.xxx>词<mm:ss.xxx>词…<mm:ss.xxx>`），这是逐字歌词里兼容面最广的通用格式
 *   （foobar2000 ESLyric / Poweramp / Salt Player / MusicBee 等均识别；不识别的播放器也只是多显示
 *   尖括号）。不再写 LX 私有的 `[awlrc:...]` base64 块。
 * - encodeLyric：按设置的编码（utf8 / gbk）转 Buffer，带 BOM（对齐 lx 的 iconv-lite addBOM）。
 */
import iconv from 'iconv-lite'
import type { Lyric } from '@common'

const timeFieldExp = /^(?:\[[\d:.]+\])+/g
const timeExp = /\d{1,3}(:\d{1,3}){0,2}(?:\.\d{1,3})/g
const wordTagExp = /<[\d:.]+>/g

/** `[mm:ss.xx]` / `[mm:ss.xxx]` / `[h:mm:ss]` 标签正文 → 毫秒；不可解析返回 NaN */
const labelToMs = (label: string): number => {
  const [main, frac = ''] = label.split('.')
  const parts = main.split(':').map((x) => parseInt(x, 10))
  if (parts.some((x) => Number.isNaN(x))) return NaN
  let sec = 0
  for (const x of parts) sec = sec * 60 + x
  // 小数段按位数补齐到毫秒（.23 → 230，.230 → 230）
  const ms = frac ? parseInt(frac.padEnd(3, '0').slice(0, 3), 10) : 0
  return sec * 1000 + ms
}

interface TimeLabel {
  ms: number
  /** 主歌词里的原样标签正文（不含方括号），翻译行重写成它以便播放器按同一时间戳合并 */
  raw: string
}

/**
 * 主/扩展歌词时间轴允许的偏差。QQ 主歌词由 QRC 重建为 3 位毫秒，翻译却是旧接口的
 * 2 位百分秒（截断而非四舍五入），两者最多差 9ms；其它源同网格产出、偏差为 0。
 */
const ALIGN_TOLERANCE_MS = 60

/** 在主歌词时间点里找与 ms 最接近且在容差内的一个（labels 已按 ms 升序） */
const nearestLabel = (labels: TimeLabel[], ms: number): TimeLabel | null => {
  let lo = 0
  let hi = labels.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (labels[mid].ms < ms) lo = mid + 1
    else hi = mid
  }
  let best: TimeLabel | null = null
  for (const i of [lo - 1, lo]) {
    const c = labels[i]
    if (!c) continue
    const d = Math.abs(c.ms - ms)
    if (d <= ALIGN_TOLERANCE_MS && (!best || d < Math.abs(best.ms - ms))) best = c
  }
  return best
}

/**
 * 把扩展歌词（翻译/罗马音）的时间轴对齐到主歌词已有时间点：
 * 对不上的时间点丢弃（避免多出无主歌词对应的行），对上的改写成主歌词的原样标签
 * （主/扩展来源不同，毫秒位数常不一致，字符串不相等时播放器不会把翻译并到同一行）。
 */
const filterExtendedLyricLabel = (lrcTimeLabels: TimeLabel[], extendedLyric: string): string => {
  const extendedLines = extendedLyric.split(/\r\n|\n|\r/)
  const lines: string[] = []
  for (const raw of extendedLines) {
    const line = raw.trim()
    const result = timeFieldExp.exec(line)
    timeFieldExp.lastIndex = 0
    if (!result) continue

    const timeField = result[0]
    const text = line.replace(timeFieldExp, '').trim()
    if (!text) continue
    const times = timeField.match(timeExp)
    if (times == null) continue

    const newTimes = new Set<string>()
    for (const time of times) {
      const hit = nearestLabel(lrcTimeLabels, labelToMs(time))
      if (hit) newTimes.add(hit.raw)
    }
    if (!newTimes.size) continue
    lines.push(`[${[...newTimes].join('][')}]${text}`)
  }
  return lines.join('\n')
}

/** 主歌词里有正文的行的时间点（升序、去重；同一 ms 保留首次出现的原样标签） */
const parseLrcTimeLabel = (lrc: string): TimeLabel[] => {
  const byMs = new Map<number, string>()
  for (const raw of lrc.split(/\r\n|\n|\r/)) {
    const line = raw.trim()
    const result = timeFieldExp.exec(line)
    timeFieldExp.lastIndex = 0
    if (!result) continue
    const timeField = result[0]
    const text = line.replace(timeFieldExp, '').replace(wordTagExp, '').trim()
    if (!text) continue
    const times = timeField.match(timeExp)
    if (times == null) continue
    for (const time of times) {
      const ms = labelToMs(time)
      if (!Number.isNaN(ms) && !byMs.has(ms)) byMs.set(ms, time)
    }
  }
  return [...byMs].map(([ms, raw]) => ({ ms, raw })).sort((a, b) => a.ms - b.ms)
}

/**
 * 主歌词体：逐字开启时按行时间标签把 char 的增强行并入 lrc。
 * 各源 char 与 lrc 由同一网格产出、行标签一致；没有逐字时间的行 char 里为空文本（kg/qq）
 * 或纯文本（kw），这类行保留 lrc 原行，保证不丢词。
 */
const buildEnhancedBody = (lrcData: Lyric): string => {
  if (!lrcData.char.trim()) return lrcData.lrc
  const charLines = new Map<number, string>()
  for (const raw of lrcData.char.split(/\r\n|\n|\r/)) {
    const line = raw.trim()
    const result = timeFieldExp.exec(line)
    timeFieldExp.lastIndex = 0
    if (!result) continue
    const text = line.replace(timeFieldExp, '').replace(wordTagExp, '').trim()
    if (!text) continue
    const times = result[0].match(timeExp)
    if (!times) continue
    charLines.set(labelToMs(times[0]), line)
  }
  if (!charLines.size) return lrcData.lrc
  return lrcData.lrc
    .split(/\r\n|\n|\r/)
    .map((raw) => {
      const line = raw.trim()
      const result = timeFieldExp.exec(line)
      timeFieldExp.lastIndex = 0
      const times = result?.[0].match(timeExp)
      if (!times) return raw
      return charLines.get(labelToMs(times[0])) ?? raw
    })
    .join('\n')
}

/**
 * 拼装歌词文本。withWords 开启时主歌词体为增强 LRC（逐字，char），downloadTlrc 对应翻译（trans），
 * downloadRlrc 对应罗马音（roma）；翻译/罗马音行仍按主歌词的时间点对齐追加在后。
 */
export function buildLyrics(
  lrcData: Lyric,
  withWords: boolean,
  downloadTlrc: boolean,
  downloadRlrc: boolean
): string {
  if (!lrcData.trans && !lrcData.roma && !lrcData.char) return lrcData.lrc

  let lrc = withWords ? buildEnhancedBody(lrcData) : lrcData.lrc
  const lrcTimeLabels = parseLrcTimeLabel(lrc)

  if (downloadTlrc && lrcData.trans) {
    lrc = lrc.trim() + `\n\n${filterExtendedLyricLabel(lrcTimeLabels, lrcData.trans)}\n`
  }
  if (downloadRlrc && lrcData.roma) {
    lrc = lrc.trim() + `\n\n${filterExtendedLyricLabel(lrcTimeLabels, lrcData.roma)}\n`
  }
  return lrc
}

/** 歌词编码（utf8 / gbk），带 BOM（对齐 lx 的 iconv-lite addBOM: true）。 */
export function encodeLyric(text: string, format: 'utf8' | 'gbk'): Buffer {
  return iconv.encode(text, format, { addBOM: true })
}
