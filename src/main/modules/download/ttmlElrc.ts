/**
 * Apple Music TTML → ELRC（增强 LRC）。
 *
 * 标签里能装的逐字歌词只有 ELRC 这一种通用格式（`[mm:ss.xxx]<mm:ss.xxx>词…<mm:ss.xxx>`），
 * 而 Apple Music 的逐字时间只存在于原始 TTML 的 `<p begin/end>` 与 `<span begin/end>` 上；
 * `lrc` / `char` 那几轨是后端把 TTML 压平的产物，未必带词级停顿。所以下载时自己解 TTML。
 *
 * 刻意不依赖渲染层的 kit 解析器（那是 DOM 取向的 vendored 代码，主进程跑不了）：
 * 这里只做「唱词行 + 逐字时间」一件事，x-bg / x-translation / x-roman 这类注释轨
 * 一律跳过（翻译与音译由调用方按现有 buildLyrics 逻辑另拼）。
 */

/** 注释类 role：内容不是唱词，不能进 ELRC */
const ANNOTATION_ROLES = new Set(['x-bg', 'x-translation', 'x-roman'])

/** `hh:mm:ss.fff` / `mm:ss.fff` / `ss.fff` / 带 s、ms、m、h 单位的写法 → 毫秒；解析不出返回 NaN */
function parseTtmlTime(raw: string | undefined): number {
  if (!raw) return NaN
  const trimmed = raw.trim()
  if (!trimmed) return NaN
  // TTML 允许结尾带时间单位；Apple 的清单实际只给 hh:mm:ss.fff 与 s.fff
  const unit = /(ms|s|m|h)$/.exec(trimmed)?.[0]
  const body = unit ? trimmed.slice(0, -unit.length).trim() : trimmed
  const parts = body.split(':').map((x) => Number(x))
  if (!parts.length || parts.some((n) => !Number.isFinite(n))) return NaN
  let seconds = 0
  for (const p of parts) seconds = seconds * 60 + p
  switch (unit) {
    case 'ms':
      return seconds
    case 'm':
      return seconds * 60000
    case 'h':
      return seconds * 3600000
    default:
      return seconds * 1000
  }
}

/** 毫秒 → `mm:ss.xxx`（与 crypto/lyric 的 formatElyricTime 同位对齐；分钟不封顶） */
function tag(ms: number): string {
  const total = Math.max(0, Math.round(ms))
  const minutes = Math.floor(total / 60000)
  const seconds = (total % 60000) / 1000
  return `${String(minutes).padStart(2, '0')}:${seconds.toFixed(3).padStart(6, '0')}`
}

function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&amp;/g, '&')
}

/** 取标签属性值；Apple 的 TTML 一律用双引号 */
function attr(source: string, name: string): string | undefined {
  const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*"([^"]*)"`, 'i').exec(source)
  return m ? decodeEntities(m[1]) : undefined
}

interface Word {
  text: string
  start: number
  end: number
}

interface Line {
  start: number
  end: number
  words: Word[]
  /** span 之外的纯文本（无词级时间的行用） */
  plain: string
}

/** span 帧：annotation 丢弃整段内容，word 产出逐字，other 只把文本透传给父级 */
type FrameKind = 'annotation' | 'word' | 'other'

interface Frame {
  kind: FrameKind
  start: number
  end: number
  text: string
}

/** 解析单个 `<p>` 片段（block 从 `<p` 开始、到 `</p>` 结束） */
function parseLine(block: string): Line | null {
  const openEnd = block.indexOf('>')
  if (openEnd < 0) return null
  const openTag = block.slice(0, openEnd)
  const inner = block.slice(openEnd + 1, block.lastIndexOf('</'))
  const start = parseTtmlTime(attr(openTag, 'begin'))
  if (!Number.isFinite(start)) return null
  const endRaw = parseTtmlTime(attr(openTag, 'end'))
  const durRaw = parseTtmlTime(attr(openTag, 'dur'))
  const declaredEnd = Number.isFinite(endRaw)
    ? endRaw
    : Number.isFinite(durRaw)
      ? start + durRaw
      : NaN

  const words: Word[] = []
  const stack: Frame[] = []
  let plain = ''
  /** > 0 表示当前文本位于注释轨（x-bg 等）内部，整段丢弃 */
  let annotationDepth = 0

  const appendText = (text: string): void => {
    if (annotationDepth > 0) return
    const top = stack[stack.length - 1]
    if (top) top.text += text
    else plain += text
  }
  /** 帧弹出后把非唱词文本还给父级，避免把注释轨的内容漏进 plain */
  const forwardText = (frame: Frame): void => {
    if (!frame.text) return
    const top = stack[stack.length - 1]
    if (top) top.text += frame.text
    else plain += frame.text
  }

  // 逐 token 走：span 开闭维护栈，文本按当前栈顶归类
  const tokenExp = /<span\b([^>]*)>|<\/span>/gi
  let cursor = 0
  let m: RegExpExecArray | null
  while ((m = tokenExp.exec(inner))) {
    if (m.index > cursor) appendText(decodeEntities(inner.slice(cursor, m.index)))
    cursor = m.index + m[0].length

    if (m[1] === undefined) {
      // </span>
      const frame = stack.pop()
      if (!frame) continue
      if (frame.kind === 'annotation') annotationDepth = Math.max(0, annotationDepth - 1)
      if (frame.kind === 'word') {
        // 注释轨里嵌套的带时间 span 不是唱词（和声/翻译），直接丢弃
        if (annotationDepth > 0) continue
        const text = frame.text.trim()
        if (text) words.push({ text, start: frame.start, end: frame.end })
      } else if (frame.kind === 'other' && annotationDepth === 0) {
        forwardText(frame)
      }
      continue
    }

    const body = m[1]
    const role = attr(body, 'ttm:role') ?? attr(body, 'role')
    if (role && ANNOTATION_ROLES.has(role)) {
      annotationDepth++
      stack.push({ kind: 'annotation', start: NaN, end: NaN, text: '' })
      continue
    }
    if (annotationDepth > 0) {
      // 注释轨内部的任意 span 都只是容器，内容同样丢弃
      stack.push({ kind: 'other', start: NaN, end: NaN, text: '' })
      continue
    }
    const begin = parseTtmlTime(attr(body, 'begin'))
    if (!Number.isFinite(begin)) {
      stack.push({ kind: 'other', start: NaN, end: NaN, text: '' })
      continue
    }
    const spanEnd = parseTtmlTime(attr(body, 'end'))
    const spanDur = parseTtmlTime(attr(body, 'dur'))
    stack.push({
      kind: 'word',
      start: begin,
      end: Number.isFinite(spanEnd) ? spanEnd : Number.isFinite(spanDur) ? begin + spanDur : begin,
      text: ''
    })
  }
  if (cursor < inner.length) appendText(decodeEntities(inner.slice(cursor)))

  const text = plain.replace(/\s+/g, ' ').trim()
  if (!words.length && !text) return null
  // 行尾补齐：TTML 没给 end 时取最后一个词的结束时间，播放器才能把这一行擦干净
  const end = Number.isFinite(declaredEnd)
    ? declaredEnd
    : words.length
      ? words[words.length - 1].end
      : start
  return { start, end, words, plain: text }
}

/**
 * TTML → ELRC 文本。解析不出任何唱词行时返回空串（调用方回退到 lrc/char）。
 * 有逐字的行：`[00:12.345]<00:12.345>词<00:12.600>词<00:13.200>`；纯文本行：`[00:12.345]词`。
 */
export function ttmlToElrc(ttml: string): string {
  if (!ttml || !ttml.trim()) return ''
  // 只取 <body> 里的 <p>：<metadata> 里也有 p 元素（词曲信息、翻译块），不能混进来
  const bodyMatch = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(ttml)
  const body = bodyMatch ? bodyMatch[1] : ttml
  const lines: string[] = []
  const pExp = /<p\b[^>]*>[\s\S]*?<\/p>/gi
  let m: RegExpExecArray | null
  while ((m = pExp.exec(body))) {
    const line = parseLine(m[0])
    if (!line) continue
    const lineTag = `[${tag(line.start)}]`
    if (!line.words.length) {
      lines.push(`${lineTag}${line.plain}`)
      continue
    }
    let out = ''
    let lastEnd = line.start
    for (const w of line.words) {
      out += `<${tag(w.start)}>${w.text}`
      lastEnd = Math.max(lastEnd, w.end)
    }
    lines.push(`${lineTag}${out}<${tag(lastEnd)}>`)
  }
  return lines.join('\n')
}
