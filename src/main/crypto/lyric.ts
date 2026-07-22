/**
 * 歌词解密与格式转换（移植自 cpp/Lrc/Lrc.cpp + LrcParser.kt，纯 JS 实现）。
 * - decryptKrc：酷狗 KRC（跳 4 字节 magic → XOR key → zlib inflate）
 * - decryptKuwo：酷我（找 \r\n\r\n → inflate → base64 → XOR yeelion → GB18030）
 * - decryptQrc：QQ QRC（hex → 3DES-EDE → inflate）
 * 转换函数把各家逐字格式归一化为 music-lyric-kit 可解析的增强 LRC：
 *   行首 [mm:ss.xx]，逐字 <offsetMs,durMs>字（TIME_TAG_2 相对时间）。
 */
import { inflateSync } from 'node:zlib'
import { qqQrcDecrypt } from './qqDes'

const KRC_KEY = Buffer.from([64, 71, 97, 119, 94, 50, 116, 71, 81, 54, 49, 45, 206, 210, 110, 105])
const YEELION = Buffer.from('yeelion', 'latin1')

function fmtLrcTime(ms: number): string {
  // 保留完整毫秒精度（3 位小数，截断不四舍五入）。
  // 逐字歌词的行起始必须与翻译/音译 LRC 的行时间精确到毫秒一致，
  // 否则 music-lyric-kit 以 0 容差按时间对齐翻译/音译时会整行漏配（错位）。
  const total = Math.max(0, Math.floor(ms))
  const m = Math.floor(total / 60000)
  const s = Math.floor((total % 60000) / 1000)
  const frac = total % 1000
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(frac).padStart(3, '0')}`
}

/** 酷狗 KRC 解密 → UTF-8 文本 */
export function decryptKrc(data: Buffer): string {
  if (data.length <= 4) return ''
  const body = data.subarray(4)
  const out = Buffer.allocUnsafe(body.length)
  for (let i = 0; i < body.length; i++) out[i] = body[i] ^ KRC_KEY[i % 16]
  try {
    return inflateSync(out).toString('utf-8')
  } catch {
    return ''
  }
}

/** 酷我歌词解密 → GB18030 文本 */
export function decryptKuwo(data: Buffer): string {
  const sep = data.indexOf(Buffer.from([0x0d, 0x0a, 0x0d, 0x0a]))
  const start = sep !== -1 ? sep + 4 : 0
  let inflated: Buffer
  try {
    inflated = inflateSync(data.subarray(start))
  } catch {
    return ''
  }
  // inflate 结果是 base64 文本
  let bytes = Buffer.from(inflated.toString('latin1'), 'base64')
  if (!bytes.length) bytes = Buffer.from(inflated)
  const out = Buffer.allocUnsafe(bytes.length)
  for (let i = 0; i < bytes.length; i++) out[i] = bytes[i] ^ YEELION[i % 7]
  try {
    return new TextDecoder('gb18030').decode(out)
  } catch {
    return out.toString('utf-8')
  }
}

/** 酷我歌词请求参数：明文 XOR yeelion + base64 */
export function buildKuwoParams(id: string): string {
  const plain = `user=12345,web,web,web&requester=localhost&req=1&rid=MUSIC_${id}&lrcx=1`
  const buf = Buffer.from(plain, 'latin1')
  for (let i = 0; i < buf.length; i++) buf[i] ^= YEELION[i % 7]
  return buf.toString('base64')
}

/** QQ / JOOX QRC 解密（hex → 改版三重 DES → inflate）→ UTF-8 文本（含 XML） */
export function decryptQrc(hex: string): string {
  if (!hex) return ''
  const data = Buffer.from(hex, 'hex')
  if (!data.length) return ''
  try {
    const dec = qqQrcDecrypt(data)
    return inflateSync(dec).toString('utf-8')
  } catch {
    return ''
  }
}

/**
 * 酷狗 KRC 文本 → 增强 LRC。
 * KRC 行：[start,dur]<off,dur,x>字...  →  [mm:ss.xx]<off,dur>字...
 */
export function krcToLrc(text: string): string {
  const out: string[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    const m = /^\[(\d+),(\d+)\](.*)$/.exec(line)
    if (!m) continue
    const lineStart = parseInt(m[1], 10)
    // KRC 逐字 <off,dur,x>字（off 相对行首）→ <mm:ss.xx>字（绝对时间）
    const content = m[3].replace(
      /<(\d+),(\d+),\d+>([^<]*)/g,
      (_all, off: string, _dur: string, word: string) =>
        `<${fmtLrcTime(lineStart + parseInt(off, 10))}>${word}`
    )
    out.push(`[${fmtLrcTime(lineStart)}]${content}`)
  }
  return out.join('\n')
}

/**
 * 酷我文本 → 三轨（行级 lrc + 逐字 char + 翻译 trans）。完整移植 LrcParser.parseKw。
 * - `[kuwo:八进制]` 头 → kwOffset1/2；逐字 <v1,v2> 用除法公式还原绝对时间 → <mm:ss.xxx>字。
 * - 翻译轨靠重复时间戳分离（同一时间戳的第二行视为上一行的翻译）。
 */
function fmtElyricTime(ms: number): string {
  const m = Math.floor(ms / 60000)
  const s = ((ms % 60000) / 1000).toFixed(3).padStart(6, '0')
  return `${String(m).padStart(2, '0')}:${s}`
}

export function parseKuwo(text: string): { lrc: string; char: string; trans: string } {
  const lines = text.split('\n')
  const rxTag = /^\[(ver|ti|ar|al|offset|by|kuwo):(.*)\]$/
  const rxTime = /^\[(\d{1,2}):(\d{1,2})\.(\d{1,3})\]/
  const rxWord = /<(-?\d+),(-?\d+)(?:,-?\d+)?>([^<]*)/g
  const rxWordClean = /<-?\d+,-?\d+(?:,-?\d+)?>/g

  // 1) 读 [kuwo:八进制] 头
  let kwOffset1 = 1
  let kwOffset2 = 1
  let kwDecodeOk = false
  for (const line of lines) {
    const t = line.trim()
    const tm = rxTag.exec(t)
    if (tm && tm[1] === 'kuwo') {
      let content = tm[2]
      const cut = content.indexOf('][')
      if (cut !== -1) content = content.slice(0, cut)
      const octalVal = parseInt(content.trim(), 8)
      if (Number.isFinite(octalVal)) {
        kwOffset1 = Math.trunc(octalVal / 10)
        kwOffset2 = octalVal % 10
        if (kwOffset1 !== 0 && kwOffset2 !== 0) kwDecodeOk = true
      }
      break
    }
  }

  // 2) 逐行解析：[timeStr, cleanContent, chaseOrClean]
  const timeMsList: number[] = []
  const parsed: [string, string, string][] = []
  let hasWordTiming = false

  for (const raw of lines) {
    const line = raw.trim()
    if (!line || rxTag.test(line)) continue
    const tm = rxTime.exec(line)
    if (!tm) continue
    const timeStr = tm[0]
    const content = line.slice(timeStr.length)
    const min = parseInt(tm[1], 10)
    const sec = parseInt(tm[2], 10)
    let msVal = parseInt(tm[3], 10)
    if (tm[3].length === 2) msVal *= 10
    else if (tm[3].length === 1) msVal *= 100
    const lineStartMs = min * 60000 + sec * 1000 + msVal

    const cleanContent = content.replace(rxWordClean, '')

    let chase = ''
    let lastEnd = 0
    let prevEnd = 0
    let lineHasWords = false
    rxWord.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = rxWord.exec(content))) {
      lineHasWords = true
      const v1 = parseInt(m[1], 10)
      const v2 = parseInt(m[2], 10)
      const word = m[3]
      let startTime: number
      let endTime: number
      if (kwDecodeOk) {
        const relStart = Math.abs(Math.trunc((v1 + v2) / (kwOffset1 * 2)))
        const relDur = Math.abs(Math.trunc((v1 - v2) / (kwOffset2 * 2)))
        let absStart = lineStartMs + relStart
        if (prevEnd > 0 && absStart < prevEnd) absStart = prevEnd
        startTime = absStart
        endTime = startTime + relDur
      } else {
        startTime = v1 < lineStartMs / 2 ? lineStartMs + v1 : v1
        endTime = startTime + v2
      }
      chase += `<${fmtElyricTime(startTime)}>${word}`
      lastEnd = endTime
      prevEnd = endTime
    }
    if (lineHasWords && lastEnd > 0) chase += `<${fmtElyricTime(lastEnd)}>`
    if (lineHasWords) hasWordTiming = true

    timeMsList.push(lineStartMs)
    parsed.push([timeStr, cleanContent, lineHasWords ? chase : cleanContent])
  }

  // 3) 重复时间戳 → 分离主歌词 / 翻译
  const lrcIdx: number[] = []
  const transIdx: [number, number][] = []
  const seen = new Set<number>()
  for (let i = 0; i < parsed.length; i++) {
    const timeMs = timeMsList[i]
    if (seen.has(timeMs)) {
      if (lrcIdx.length >= 2) {
        const transDataIdx = lrcIdx.pop() as number
        const prevLrcDataIdx = lrcIdx[lrcIdx.length - 1]
        transIdx.push([transDataIdx, prevLrcDataIdx])
        lrcIdx.push(i)
      }
    } else {
      lrcIdx.push(i)
      seen.add(timeMs)
    }
  }
  // 误判保护：非逐字且译文行过多则全当主歌词
  if (
    !hasWordTiming &&
    transIdx.length > lrcIdx.length * 0.3 &&
    lrcIdx.length - transIdx.length > 6
  ) {
    transIdx.length = 0
    lrcIdx.length = 0
    for (let i = 0; i < parsed.length; i++) lrcIdx.push(i)
  }

  const lrcOut: string[] = []
  const chaseOut: string[] = []
  const transOut: string[] = []
  for (const idx of lrcIdx) {
    const d = parsed[idx]
    lrcOut.push(d[0] + d[1])
    chaseOut.push(d[0] + d[2])
  }
  for (const [ti, li] of transIdx) {
    transOut.push(parsed[li][0] + parsed[ti][1])
  }
  return { lrc: lrcOut.join('\n'), char: chaseOut.join('\n'), trans: transOut.join('\n') }
}

/**
 * 网易云 yrc 逐字 → 增强 LRC。
 * yrc 行：[start,dur](absOff,dur,0)字...  →  [mm:ss.xx]<mm:ss.xx>字...（绝对时间）
 * 跳过 `{...}` JSON 元数据行。
 */
export function yrcToLrc(text: string): string {
  const out: string[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('{')) continue
    const m = /^\[(\d+),(\d+)\](.*)$/.exec(line)
    if (!m) continue
    const lineStart = parseInt(m[1], 10)
    const body = m[3].replace(
      /\((\d+),(\d+),\d+\)([^(]*)/g,
      (_all, off: string, _dur: string, word: string) => `<${fmtLrcTime(parseInt(off, 10))}>${word}`
    )
    if (body.trim()) out.push(`[${fmtLrcTime(lineStart)}]${body}`)
  }
  return out.join('\n')
}
export function qrcToLrc(text: string): string {
  // 取出 LyricContent（可能带 XML 包裹，也可能是纯文本）
  const cm = /LyricContent="([\s\S]*?)"/.exec(text)
  const content = cm ? cm[1] : text
  const out: string[] = []
  const lineRe = /\[(\d+),(\d+)\]([^[]*)/g
  let lm: RegExpExecArray | null
  while ((lm = lineRe.exec(content))) {
    const lineStart = parseInt(lm[1], 10)
    // QRC 逐字：字(absOff,dur)（字在前，off 绝对）→ <mm:ss.xx>字
    const body = lm[3].replace(
      /([^()]*?)\((\d+),(\d+)\)/g,
      (_all, word: string, off: string, _dur: string) => `<${fmtLrcTime(parseInt(off, 10))}>${word}`
    )
    if (body.trim()) out.push(`[${fmtLrcTime(lineStart)}]${body}`)
  }
  return out.join('\n')
}
