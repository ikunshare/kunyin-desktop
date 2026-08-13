/**
 * 歌词解密与格式转换（移植自 cpp/Lrc/Lrc.cpp + LrcParser.kt，纯 JS 实现）。
 * - decryptKrc：酷狗 KRC（跳 4 字节 magic → XOR key → zlib inflate）
 * - decryptKuwo：酷我（找 \r\n\r\n → inflate → base64 → XOR yeelion → 指定编码，默认 GB18030）
 * - decryptQrc：QQ QRC（hex → 3DES-EDE → inflate）
 * 转换函数把各家逐字格式归一化为 music-lyric-kit 可解析的增强 LRC：
 *   行首 [mm:ss.xx]，逐字 <offsetMs,durMs>字（TIME_TAG_2 相对时间）。
 */
import { inflateSync } from 'node:zlib'
import { qqQrcDecrypt } from './qqDes'

const KRC_KEY = Buffer.from([64, 71, 97, 119, 94, 50, 116, 71, 81, 54, 49, 45, 206, 210, 110, 105])
const YEELION = Buffer.from('yeelion', 'latin1')

/**
 * 行首时间标签 `[mm:ss.xxx]`（对齐安卓 LrcParser.msFormat / formatTime）。
 */
function msFormat(ms: number): string {
  const total = Math.max(0, Math.floor(ms))
  const frac = total % 1000
  let rem = Math.floor(total / 1000)
  const s = rem % 60
  rem = Math.floor(rem / 60)
  const m = rem
  return `[${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(frac).padStart(3, '0')}]`
}

/**
 * 逐字时间标签内容 `mm:ss.xxx`（对齐安卓 formatElyricTime 的 `%02d:%06.3f`）。
 * 秒段含小数，两位整数补零，故 06.3f 即「ss.xxx」。
 */
function formatElyricTime(ms: number): string {
  const total = Math.max(0, ms)
  const minutes = Math.floor(total / 60000)
  const seconds = (total % 60000) / 1000
  const secStr = seconds.toFixed(3).padStart(6, '0')
  return `${String(minutes).padStart(2, '0')}:${secStr}`
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

/**
 * 酷我歌词解密。默认 GB18030（旧 newlyric 接口）；
 * 新 mlyric 接口带 `encode=utf8` 时返回 UTF-8，传 `utf-8` 即可。
 */
export function decryptKuwo(data: Buffer, encoding = 'gb18030'): string {
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
    return new TextDecoder(encoding).decode(out)
  } catch {
    return out.toString('utf-8')
  }
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

/** 酷狗 KRC 六轨解析结果（对齐安卓 LrcParser.LyricResult 的 KRC 字段）。 */
export interface KrcResult {
  lrc: string
  char: string
  chroma: string
  trans: string
  roma: string
  phonetic: string
}

/**
 * 从 `[language:base64]` 头解出 KRC 的翻译 / 逐字音译 / AI 谐音三类附加轨。
 * JSON 结构：content[]{ type, lyricContent[][] }；type 0=逐字音译(按字数组)，其余=翻译；
 * contentV2[]{ type } type 2=AI 谐音。对齐安卓 parseKg 的解析分支。
 */
function parseKrcLanguage(b64: string): {
  romaList: string[]
  romaCharList: string[][]
  transList: string[]
  phoneticList: string[]
} {
  const romaList: string[] = []
  const romaCharList: string[][] = []
  const transList: string[] = []
  const phoneticList: string[] = []
  try {
    const json = JSON.parse(Buffer.from(b64, 'base64').toString('utf-8'))
    const content: unknown[] = Array.isArray(json?.content) ? json.content : []
    for (const raw of content) {
      const item = raw as { type?: number; lyricContent?: unknown[] }
      const lc = Array.isArray(item?.lyricContent) ? item.lyricContent : []
      if (item?.type === 0) {
        for (const row of lc) {
          if (Array.isArray(row) && row.length) {
            const chars = row.map((s) => String(s ?? ''))
            romaCharList.push(chars)
            romaList.push(chars.join(''))
          } else {
            romaCharList.push([])
            romaList.push(String(row ?? ''))
          }
        }
      } else {
        for (const row of lc) {
          transList.push(
            Array.isArray(row) ? row.map((s) => String(s ?? '')).join('') : String(row ?? '')
          )
        }
      }
    }
    const contentV2: unknown[] = Array.isArray(json?.contentV2) ? json.contentV2 : []
    for (const raw of contentV2) {
      const item = raw as { type?: number; lyricContent?: unknown[] }
      if (item?.type !== 2) continue
      const lc = Array.isArray(item?.lyricContent) ? item.lyricContent : []
      for (const row of lc) {
        phoneticList.push(
          Array.isArray(row) ? row.map((s) => String(s ?? '')).join('') : String(row ?? '')
        )
      }
    }
  } catch {
    /* 语言头非法则各轨为空 */
  }
  return { romaList, romaCharList, transList, phoneticList }
}

/**
 * 酷狗 KRC 文本 → 六轨（行级 lrc + 逐字 char + 逐字音译 chroma + 翻译 trans + 行级音译 roma + AI 谐音 phonetic）。
 * 1:1 移植安卓 LrcParser.parseKg：
 * - 逐字 `<off,dur,x>字`（off 相对行首）→ 绝对时间 char 轨；行尾补 lastEnd。
 * - `[language:base64]` JSON 提供翻译/音译/AI 谐音，按行索引对齐；逐字音译按每字时间挂到 chroma。
 */
export function parseKrc(rawText: string): KrcResult {
  const empty: KrcResult = { lrc: '', char: '', chroma: '', trans: '', roma: '', phonetic: '' }
  if (!rawText) return empty
  let text = rawText.replace(/\r/g, '').replace(/^.*\[id:\$\w+]\n/, '')

  const langM = /\[language:([\w=/+]+)]/.exec(text)
  const lang = langM
    ? parseKrcLanguage(langM[1])
    : { romaList: [], romaCharList: [], transList: [], phoneticList: [] }
  if (langM) text = text.replace(langM[0], '').trim()

  const lrcOut: string[] = []
  const charOut: string[] = []
  const chromaOut: string[] = []
  const transOut: string[] = []
  const romaOut: string[] = []
  const phoneticOut: string[] = []

  const rxTime = /\[(\d+),(\d+)]/
  const rxWord = /<(\d+),(\d+),(\d+)>([^<]*)/g
  let idx = 0

  for (const raw of text.split('\n')) {
    const line = raw
    if (!line.trim()) continue
    const tm = rxTime.exec(line)
    if (!tm) continue
    const startMs = parseInt(tm[1], 10)
    const cleanLine = line.replace(rxTime, '')
    const timeTag = msFormat(startMs)

    let textContent = ''
    let chaseContent = ''
    let lastEnd = startMs
    const wordTimings: { absStart: number; absEnd: number }[] = []

    rxWord.lastIndex = 0
    let wm: RegExpExecArray | null
    while ((wm = rxWord.exec(cleanLine))) {
      const off = parseInt(wm[1], 10)
      const dur = parseInt(wm[2], 10)
      const word = wm[4]
      textContent += word
      const absStart = startMs + off
      chaseContent += `<${formatElyricTime(absStart)}>${word}`
      lastEnd = absStart + dur
      wordTimings.push({ absStart, absEnd: lastEnd })
    }
    if (chaseContent) chaseContent += `<${formatElyricTime(lastEnd)}>`

    lrcOut.push(timeTag + textContent)
    charOut.push(timeTag + chaseContent)

    // 逐字音译（type 0 的按字数组）→ 挂到每字时间
    const romaChars = lang.romaCharList[idx]
    if (romaChars && romaChars.length && wordTimings.length) {
      let chroma = ''
      const count = Math.min(romaChars.length, wordTimings.length)
      for (let w = 0; w < count; w++) {
        chroma += `<${formatElyricTime(wordTimings[w].absStart)}>${romaChars[w]}`
      }
      if (count > 0) chroma += `<${formatElyricTime(wordTimings[count - 1].absEnd)}>`
      chromaOut.push(timeTag + chroma)
    }
    if (idx < lang.transList.length) transOut.push(timeTag + lang.transList[idx])
    if (idx < lang.romaList.length) romaOut.push(timeTag + lang.romaList[idx])
    if (idx < lang.phoneticList.length) phoneticOut.push(timeTag + lang.phoneticList[idx])
    idx++
  }

  return {
    lrc: lrcOut.join('\n'),
    char: charOut.join('\n'),
    chroma: chromaOut.join('\n'),
    trans: transOut.join('\n'),
    roma: romaOut.join('\n'),
    phonetic: phoneticOut.join('\n')
  }
}

/**
 * 酷我文本 → 五轨（行级 lrc + 逐字 char + 翻译 trans + 行级音译 roma + 逐字音译 chroma）。移植 LrcParser.parseKw。
 * - `[kuwo:八进制]` 头 → kwOffset1/2；逐字 <v1,v2> 用除法公式还原绝对时间 → <mm:ss.xxx>字。
 * - 翻译轨靠重复时间戳分离（同一时间戳的第二行视为上一行的翻译）。
 * - 音译轨（`trans_type=roma` 响应的新类型）：主歌词前插入一行全 `<0,0>` 标签、正文纯拉丁的
 *   音节行（`<0,0>yan <0,0>zin …`），是**上一行**主歌词的罗马音。识别后按主行索引 1:1 挂回。
 * - 逐字音译：酷我音译只有行级音节串、没有自身时间，靠「人工对齐」——把空格分隔的音节按 1:1
 *   挂到上一主行的逐字绝对时间上，生成 `<mm:ss.xxx>音节` 轨（对齐安卓 parseKg 的 chroma）。
 * - 结尾孤立的音译行（无下一主行）同样挂到上一主行，避免被当成唱词混入 lrc。
 */
export function parseKuwo(text: string): {
  lrc: string
  char: string
  trans: string
  roma: string
  chroma: string
} {
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

  // 2) 逐行解析
  const timeMsList: number[] = []
  const parsed: {
    timeStr: string
    clean: string
    chase: string
    wordTimings: { start: number; end: number }[]
    hasTags: boolean
    allZero: boolean
    isRoma: boolean
    empty: boolean
  }[] = []

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
    let allZero = true
    let hasTags = false
    const wordTimings: { start: number; end: number }[] = []
    rxWord.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = rxWord.exec(content))) {
      hasTags = true
      const v1 = parseInt(m[1], 10)
      const v2 = parseInt(m[2], 10)
      if (v1 !== 0 || v2 !== 0) allZero = false
      const word = m[3]
      lineHasWords = true
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
      chase += `<${formatElyricTime(startTime)}>${word}`
      wordTimings.push({ start: startTime, end: endTime })
      lastEnd = endTime
      prevEnd = endTime
    }
    if (lineHasWords && lastEnd > 0) chase += `<${formatElyricTime(lastEnd)}>`

    const clean = cleanContent.trim()
    const isLatin = !!clean && /^[\x20-\x7e\s]+$/.test(clean) && /[A-Za-z]/.test(clean)
    timeMsList.push(lineStartMs)
    parsed.push({
      timeStr,
      clean: cleanContent,
      chase: lineHasWords ? chase : cleanContent,
      wordTimings,
      hasTags,
      allZero,
      isRoma: hasTags && allZero && !!clean && isLatin,
      empty: !clean
    })
  }

  // 3) 分类主行 / 音译 / 翻译。音译行（含结尾孤立行）挂到「上一主行」，翻译挂重复时间戳的首行。
  const mainIdx: number[] = []
  const romaOf = new Map<number, string>()
  const chromaOf = new Map<number, string>()
  const transOf = new Map<number, string>()
  let hasWordTiming = false
  for (let i = 0; i < parsed.length; i++) {
    const line = parsed[i]
    if (line.hasTags) hasWordTiming = true
    // 纯空行（无逐字标签，如结尾占位）不是唱词，跳过
    if (line.empty && !line.hasTags) continue
    if (line.isRoma) {
      // 音译行：挂到上一条主行（时间戳用该主行的，天然 1:1）
      const last = mainIdx[mainIdx.length - 1]
      if (last != null) {
        romaOf.set(last, line.clean)
        // 逐字音译：空格分隔的音节 1:1 挂到上一主行每字绝对时间（对齐安卓 parseKg 的 chroma）。
        // 音节数≠字数（日文促音/长音连读）时按 min 截断，多余音节丢弃，酷狗同样处理。
        const target = parsed[last]
        if (target.wordTimings.length) {
          const syllables = line.clean.trim().split(/\s+/)
          const count = Math.min(syllables.length, target.wordTimings.length)
          let chroma = ''
          for (let w = 0; w < count; w++) {
            chroma += `<${formatElyricTime(target.wordTimings[w].start)}>${syllables[w]}`
          }
          if (count > 0) chroma += `<${formatElyricTime(target.wordTimings[count - 1].end)}>`
          if (chroma) chromaOf.set(last, chroma)
        }
      }
      continue
    }
    if (i + 1 < parsed.length && timeMsList[i + 1] === timeMsList[i]) {
      // 重复时间戳 [首行, 主唱词]：首行为上一主行的翻译/元信息（AI 音译声明、空占位等）
      const last = mainIdx[mainIdx.length - 1]
      if (last != null && !(line.hasTags && line.allZero && line.empty)) {
        transOf.set(last, line.clean)
      }
      mainIdx.push(i + 1)
      i++
      continue
    }
    mainIdx.push(i)
  }

  // 误判保护：非逐字且翻译行过多则全当主歌词（保持旧行为，仅对无逐字的旧数据生效）
  if (!hasWordTiming && transOf.size > mainIdx.length * 0.3 && mainIdx.length - transOf.size > 6) {
    transOf.clear()
    mainIdx.length = 0
    for (let i = 0; i < parsed.length; i++) {
      if (!parsed[i].empty) mainIdx.push(i)
    }
  }

  // 4) 按主行索引 1:1 输出（音译/翻译缺行给空串，渲染层按索引对齐、空正文隐藏）
  const lrcOut: string[] = []
  const chaseOut: string[] = []
  const transOut: string[] = []
  const romaOut: string[] = []
  const chromaOut: string[] = []
  for (const idx of mainIdx) {
    const d = parsed[idx]
    lrcOut.push(d.timeStr + d.clean)
    chaseOut.push(d.timeStr + d.chase)
    transOut.push(d.timeStr + (transOf.get(idx) ?? ''))
    romaOut.push(d.timeStr + (romaOf.get(idx) ?? ''))
    chromaOut.push(d.timeStr + (chromaOf.get(idx) ?? ''))
  }
  return {
    lrc: lrcOut.join('\n'),
    char: chaseOut.join('\n'),
    trans: transOut.join('\n'),
    roma: romaOut.join('\n'),
    chroma: chromaOut.join('\n')
  }
}

/**
 * QQ / JOOX QRC 文本 → { lrc(行级纯文本), char(逐字增强 LRC) }。
 * 1:1 移植安卓 LrcParser.parseTxQrc：
 * - 逐字标签 `(off,dur)` 用 substring 按索引切词，标签之间的文本原样保留（含括号，不丢字）。
 * - 行首用 `[mm:ss.xxx]`；逐字用绝对偏移 `<mm:ss.xxx>`（formatElyricTime）；行尾补 lastEnd。
 */
export function parseTxQrc(text: string): { lrc: string; char: string } {
  if (!text) return { lrc: '', char: '' }
  const cleaned = text.replace(/ LyricContent=".*?"/g, '')
  const lines = cleaned.split('\n')
  const lrcLines: string[] = []
  const chaseLines: string[] = []
  const rxLine = /^\[(\d+),(\d+)\]/
  const rxWordSplit = /\((\d+),(\d+)\)/g

  for (const raw of lines) {
    const line = raw.trim()
    const lm = rxLine.exec(line)
    if (!lm) continue
    const startMs = parseInt(lm[1], 10)
    const timeTag = msFormat(startMs)
    const content = line.replace(rxLine, '')

    let cleanText = ''
    let chaseText = ''
    let lastIndex = 0
    let lastEnd = 0
    rxWordSplit.lastIndex = 0
    let wm: RegExpExecArray | null
    while ((wm = rxWordSplit.exec(content))) {
      const word = content.slice(lastIndex, wm.index)
      cleanText += word
      const off = parseInt(wm[1], 10)
      const dur = parseInt(wm[2], 10)
      chaseText += `<${formatElyricTime(off)}>${word}`
      lastEnd = off + dur
      lastIndex = rxWordSplit.lastIndex
    }
    if (lastIndex < content.length) cleanText += content.slice(lastIndex)
    if (lastEnd > 0) chaseText += `<${formatElyricTime(lastEnd)}>`

    lrcLines.push(timeTag + cleanText)
    chaseLines.push(timeTag + chaseText)
  }
  return { lrc: lrcLines.join('\n'), char: chaseLines.join('\n') }
}

/** 是否含标准 LRC 行 `[mm:ss.xx]`（对齐安卓 isStandardLrc，用于 QRC 无逐字时的回退判定）。 */
export function isStandardLrc(text: string): boolean {
  return text.split('\n').some((l) => /^\[\d{1,2}:\d{1,2}[.:]\d{1,3}\]/.test(l.trim()))
}

/**
 * 网易 yrc 逐字文本 → { lyric(行级纯文本), chase(逐字增强 LRC) }。
 * 1:1 移植安卓 parseLyric：行首 `[start,dur]`，逐字 `(off,dur,?)字`（时间在前、字在后）。
 * 用 `(时间标签)(字)` 配对正则并按索引取字，含括号也不丢；行尾补 lastEnd。
 */
export function parseYrc(text: string): { lyric: string; chase: string } {
  const lrcLines: string[] = []
  const lxLines: string[] = []
  const rxLineTime = /^\[(\d+),(\d+)(?:,\d+)?\]/
  const rxWordAll = /\(\d+,\d+(?:,\d+)?\)/g
  const rxPair = /(\(\d+,\d+(?:,\d+)?\))([^(]*)/g
  const rxTime = /\((\d+),(\d+)(?:,\d+)?\)/

  for (const raw of text.split('\n')) {
    const line = raw.trim()
    const lm = rxLineTime.exec(line)
    if (!lm) continue
    const startMs = parseInt(lm[1], 10)
    const startTag = msFormat(startMs)
    const words = line.replace(rxLineTime, '')

    // 行级纯文本：剥掉所有逐字时间标签
    lrcLines.push(startTag + words.replace(rxWordAll, ''))

    // 逐字：(标签)(字) 配对
    let lx = ''
    let lastEndAbs = startMs
    let hasMatches = false
    rxPair.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = rxPair.exec(words))) {
      hasMatches = true
      const tm = rxTime.exec(m[1])
      if (tm) {
        const tStart = parseInt(tm[1], 10)
        const tDur = parseInt(tm[2], 10)
        lx += `<${formatElyricTime(tStart)}>${m[2]}`
        lastEndAbs = tStart + tDur
      }
    }
    if (hasMatches) {
      lx += `<${formatElyricTime(lastEndAbs)}>`
      lxLines.push(startTag + lx)
    } else {
      lxLines.push(startTag + words)
    }
  }
  return { lyric: lrcLines.join('\n'), chase: lxLines.join('\n') }
}
