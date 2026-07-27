import { Lyric } from '../../../lyric'
import { Xml } from '../../../utils'

import { parseTime } from '../../../utils'
import {
  findElementsByLocalName,
  hasChildElementByLocalName,
  getAttributeByName,
  getTextContent,
  parseTextToWords,
  parseSpanTime
} from '../../utils'
import { appendLineTranslate, appendLineRoman } from './annotation'

export interface ParseSpanOptions {
  /**
   * Intercept a span before the default word handling.
   *
   * Returns true when the hook has consumed the span.
   */
  onSpan?: (span: Xml.XmlElement, words: Lyric.Common.Word[]) => boolean
  /**
   * Observe each parsed background line together with its source span.
   *
   * Used to index background lines by their itunes:key.
   */
  onBackground?: (span: Xml.XmlElement, background: Lyric.Parsed.ParsedLineBackground) => void
}

export interface ProcessLinesResult {
  /**
   * Parsed normal lines in document order.
   */
  lines: Lyric.Parsed.ParsedLine[]
  /**
   * Lines indexed by their itunes:key, for attaching head annotations.
   */
  lineMap: Map<string, Lyric.Parsed.ParsedLineNormal>
  /**
   * Background lines indexed by their itunes:key, for attaching background annotations.
   */
  backgroundMap: Map<string, Lyric.Parsed.ParsedLineBackground>
}

const calcEndSpaceCount = (content: string) => {
  let count = 0
  for (let i = content.length - 1; i >= 0 && content[i] === ' '; i--) {
    count++
  }
  return count
}

const calcStartSpaceCount = (content: string) => {
  let count = 0
  for (let i = 0; i < content.length && content[i] === ' '; i++) {
    count++
  }
  return count
}

const parseLineAgentId = (element: Xml.XmlElement): string | null => {
  const raw = getAttributeByName(element, 'agent', true)
  return raw || null
}

const resolveLineTime = (element: Xml.XmlElement, background: boolean) => {
  const rawBegin = getAttributeByName(element, 'begin', true)
  const begin = rawBegin ? parseTime(rawBegin) : null

  const rawEnd = getAttributeByName(element, 'end', true)
  const end = rawEnd ? parseTime(rawEnd) : null

  if ((begin === null || end === null) && !background) {
    return null
  }
  return { start: begin ?? 0, end: end ?? 0 }
}

const resolveWordSpace = (content: string, isFirst: boolean) => {
  if (isFirst || content.trim()) {
    return null
  }
  const space = Lyric.Common.makeWordSpace({ count: content.length || 1 })
  return space
}

const appendWordSpan = (words: Lyric.Common.Word[], element: Xml.XmlElement): void => {
  const text = getTextContent(element)
  const trimed = text.trim()
  if (!trimed) {
    return
  }

  const time = parseSpanTime(element)
  if (!time) {
    return
  }

  const prev = words[words.length - 1]
  if (text.startsWith(' ') && (!prev || !Lyric.Common.isWordSpace(prev))) {
    words.push(Lyric.Common.makeWordSpace({ count: calcStartSpaceCount(text) }))
  }

  words.push(
    Lyric.Common.makeWordNormal({
      content: trimed,
      time: Lyric.Common.makeTime({ start: time.start, end: time.end })
    })
  )

  if (text.endsWith(' ')) {
    words.push(Lyric.Common.makeWordSpace({ count: calcEndSpaceCount(text) }))
  }
}

/**
 * Builds the ordered word list from a span-bearing element.
 *
 * Text nodes turn into spaces and plain timed spans into words.
 *
 * Spans carrying a ttm:role are handed to onRole and skipped here.
 *
 * A span consumed by options.onSpan is skipped here too.
 */
export const parseSpanWords = (
  element: Xml.XmlElement,
  onRole?: (span: Xml.XmlElement, role: string) => void,
  options?: ParseSpanOptions
): Lyric.Common.Word[] => {
  const words: Lyric.Common.Word[] = []
  const children = element.children
  for (let i = 0; i < children.length; i++) {
    const item = children[i]

    if (item.type === Xml.XmlNodeType.Text) {
      const space = resolveWordSpace(item.content, i === 0)
      if (space) {
        words.push(space)
      }
      continue
    }

    if (item.type !== Xml.XmlNodeType.Element || item.local !== 'span') {
      continue
    }

    const role = getAttributeByName(item, 'role', true)
    if (role) {
      onRole?.(item, role)
      continue
    }

    if (options?.onSpan?.(item, words)) {
      continue
    }

    appendWordSpan(words, item)
  }
  return words
}

const applyLineRole = (
  line: Lyric.Parsed.ParsedLineNormal | Lyric.Parsed.ParsedLineBackground,
  span: Xml.XmlElement,
  role: string,
  background: boolean,
  options?: ParseSpanOptions
) => {
  if (role === 'x-bg') {
    if (background || !('backgrounds' in line)) {
      return
    }
    const bg = parseBackgroundLine(span, options)
    if (bg) {
      line.backgrounds.push(bg)
      options?.onBackground?.(span, bg)
    }
    return
  }

  const text = getTextContent(span).trim()
  if (!text) {
    return
  }

  switch (role) {
    case 'x-translation':
      appendLineTranslate(line, text, getAttributeByName(span, 'lang', true))
      break
    case 'x-roman':
      appendLineRoman(line, text, getAttributeByName(span, 'lang', true))
      break
  }
}

const fillBodyWords = (
  body: Lyric.Parsed.ParsedLineNormal | Lyric.Parsed.ParsedLineBackground,
  element: Xml.XmlElement,
  background: boolean,
  options?: ParseSpanOptions
) => {
  if (!hasChildElementByLocalName(element, 'span')) {
    body.words = parseTextToWords(getTextContent(element).trim())
    return
  }
  body.words = parseSpanWords(
    element,
    (span, role) => applyLineRole(body, span, role, background, options),
    options
  )
}

const resolveLineBase = (element: Xml.XmlElement, background: boolean) => {
  const time = resolveLineTime(element, background)
  if (!time) {
    return null
  }

  if (!hasChildElementByLocalName(element, 'span') && !getTextContent(element).trim().length) {
    return null
  }

  return { time, agentId: parseLineAgentId(element) }
}

const parseBackgroundLine = (
  element: Xml.XmlElement,
  options?: ParseSpanOptions
): Lyric.Parsed.ParsedLineBackground | null => {
  const base = resolveLineBase(element, true)
  if (!base) {
    return null
  }

  const body = Lyric.Parsed.makeParsedLineBackground({ time: Lyric.Common.makeTime(base.time) })
  if (base.agentId) {
    body.agents = [base.agentId]
  }

  fillBodyWords(body, element, true, options)
  return body
}

const parseNormalLine = (
  element: Xml.XmlElement,
  options?: ParseSpanOptions
): Lyric.Parsed.ParsedLine | null => {
  const base = resolveLineBase(element, false)
  if (!base) {
    return null
  }

  const line = Lyric.Parsed.makeParsedLineNormal({ time: Lyric.Common.makeTime(base.time) })
  if (!Lyric.Parsed.isParsedLineNormal(line)) {
    return null
  }

  const body = line.body.value
  if (base.agentId) {
    body.agents = [base.agentId]
  }

  fillBodyWords(body, element, false, options)
  return line
}

export const parseLines = (
  body?: Xml.XmlElement,
  options?: ParseSpanOptions
): ProcessLinesResult => {
  const lines: Lyric.Parsed.ParsedLine[] = []
  const lineMap = new Map<string, Lyric.Parsed.ParsedLineNormal>()
  const backgroundMap = new Map<string, Lyric.Parsed.ParsedLineBackground>()

  if (!body) {
    return { lines, lineMap, backgroundMap }
  }

  // index every background line by its itunes:key while keeping any caller hook.
  const lineOptions: ParseSpanOptions = {
    ...options,
    onBackground: (span, background) => {
      options?.onBackground?.(span, background)
      const key = getAttributeByName(span, 'key', true)
      if (key) {
        backgroundMap.set(key, background)
      }
    }
  }

  const elements = findElementsByLocalName(body, 'p')
  for (const element of elements) {
    const line = parseNormalLine(element, lineOptions)
    if (!line || !Lyric.Parsed.isParsedLineNormal(line)) {
      continue
    }
    lines.push(line)
    const key = getAttributeByName(element, 'key', true)
    if (key) {
      lineMap.set(key, line.body.value)
    }
  }

  return { lines, lineMap, backgroundMap }
}
