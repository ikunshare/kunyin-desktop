import type { ElementGroups } from '../../utils'

import { Lyric } from '../../../lyric'
import { Xml } from '../../../utils'

import {
  findElementsByLocalName,
  getChildElementsByLocalName,
  hasChildElementByLocalName,
  getAttributeByName,
  getTextContent,
  parseTextToWords
} from '../../utils'
import { parseSpanWords } from './line'
import { appendLineTranslate, appendLineRoman, normalizeLanguage } from './annotation'

type AnnotationTextHandler = (
  text: Xml.XmlElement,
  line: Lyric.Parsed.ParsedLineNormal,
  language?: string,
  type?: string
) => void

const eachAnnotationText = (
  blocks: Xml.XmlElement[],
  lineMap: Map<string, Lyric.Parsed.ParsedLineNormal>,
  handle: AnnotationTextHandler
) => {
  for (const item of blocks) {
    const language = getAttributeByName(item, 'lang', true)
    const type = getAttributeByName(item, 'type')

    const texts = findElementsByLocalName(item, 'text')
    for (const text of texts) {
      const key = getAttributeByName(text, 'for')
      if (!key) {
        continue
      }
      const line = lineMap.get(key)
      if (line) {
        handle(text, line, language, type)
      }
    }
  }
}

const readReplacementWords = (text: Xml.XmlElement): Lyric.Common.Word[] => {
  if (hasChildElementByLocalName(text, 'span')) {
    return parseSpanWords(text)
  }
  const plain = getTextContent(text).trim()
  return plain ? parseTextToWords(plain) : []
}

interface BackgroundText {
  /**
   * Text content of the x-bg span.
   */
  content: string
  /**
   * The `for` attribute referencing a background line by its itunes:key.
   */
  key?: string
}

const splitBackgroundText = (
  text: Xml.XmlElement
): { main: string; backgrounds: BackgroundText[] } => {
  let main = ''
  const backgrounds: BackgroundText[] = []
  for (const child of text.children) {
    if (
      child.type === Xml.XmlNodeType.Element &&
      child.local === 'span' &&
      getAttributeByName(child, 'role', true) === 'x-bg'
    ) {
      backgrounds.push({ content: getTextContent(child), key: getAttributeByName(child, 'for') })
      continue
    }
    main += getTextContent(child)
  }
  return { main, backgrounds }
}

const attachBackgroundTexts = (
  line: Lyric.Parsed.ParsedLineNormal,
  backgrounds: BackgroundText[],
  backgroundMap: Map<string, Lyric.Parsed.ParsedLineBackground>,
  attach: (background: Lyric.Parsed.ParsedLineBackground, content: string) => void
) => {
  const list = line.backgrounds
  if (!list.length) {
    return
  }
  for (let i = 0; i < backgrounds.length; i++) {
    const content = backgrounds[i].content.trim()
    if (!content) {
      continue
    }
    // match by the `for` key when present, otherwise fall back to document order.
    const key = backgrounds[i].key
    const target = (key && backgroundMap.get(key)) || list[i]
    if (!target) {
      continue
    }
    attach(target, content)
  }
}

const attachTranslate = (
  blocks: Xml.XmlElement[],
  lineMap: Map<string, Lyric.Parsed.ParsedLineNormal>,
  backgroundMap: Map<string, Lyric.Parsed.ParsedLineBackground>
) => {
  eachAnnotationText(blocks, lineMap, (text, line, language, type) => {
    // replacement overrides the original wording (e.g. traditional to simplified).
    if (type === 'replacement') {
      const words = readReplacementWords(text)
      if (words.length) {
        line.words = words
      }
      return
    }
    // separate the x-bg pieces so they land on background lines instead of the main translation.
    const { main, backgrounds } = splitBackgroundText(text)
    // head subtitle wins over an inline x-translation of the same language.
    appendLineTranslate(line, main, language, true)
    attachBackgroundTexts(line, backgrounds, backgroundMap, (background, content) =>
      appendLineTranslate(background, content, language, true)
    )
  })
}

const hasTimedSpans = (text: Xml.XmlElement): boolean => {
  const spans = getChildElementsByLocalName(text, 'span')
  for (const span of spans) {
    if (getAttributeByName(span, 'begin', true) && getAttributeByName(span, 'end', true)) {
      return true
    }
  }
  return false
}

const findBodyWordByTime = (
  words: Lyric.Common.Word[],
  startMap: Map<number, Lyric.Common.WordNormal>,
  start: number,
  end: number
): Lyric.Common.WordNormal | undefined => {
  // roman spans align to body words by exact start time (1:1 in practice).
  const exact = startMap.get(start)
  if (exact) {
    return exact
  }
  // otherwise fall back to the largest time overlap.
  let best: Lyric.Common.WordNormal | undefined
  let bestOverlap = 0
  for (const word of words) {
    if (!Lyric.Common.isWordNormal(word) || !word.body.value.time) {
      continue
    }
    const time = word.body.value.time
    const overlap = Math.min(end, time.end) - Math.max(start, time.start)
    if (overlap > bestOverlap) {
      bestOverlap = overlap
      best = word.body.value
    }
  }
  return best
}

const hasWordSpaceBetween = (words: Lyric.Common.Word[], a: number, b: number): boolean => {
  const lo = Math.min(a, b)
  const hi = Math.max(a, b)
  for (let i = lo + 1; i < hi; i++) {
    if (Lyric.Common.isWordSpace(words[i])) {
      return true
    }
  }
  return false
}

interface RomanEntry {
  content: string
  start: number
  end: number
  target: Lyric.Common.WordNormal
  boundary: boolean
}

const attachWordRomans = (
  text: Xml.XmlElement,
  line: Lyric.Parsed.ParsedLineNormal,
  language?: string
): boolean => {
  const words = line.words

  const indexMap = new Map<Lyric.Common.WordNormal, number>()
  const startMap = new Map<number, Lyric.Common.WordNormal>()
  for (let i = 0; i < words.length; i++) {
    const word = words[i]
    if (Lyric.Common.isWordNormal(word)) {
      const value = word.body.value
      indexMap.set(value, i)
      if (value.time) {
        startMap.set(value.time.start, value)
      }
    }
  }

  const roman = parseSpanWords(text)
  const entries: RomanEntry[] = []
  for (let i = 0; i < roman.length; i++) {
    const span = roman[i]
    if (!Lyric.Common.isWordNormal(span) || !span.body.value.time) {
      continue
    }
    const value = span.body.value
    const target = findBodyWordByTime(words, startMap, value.time!.start, value.time!.end)
    if (!target) {
      continue
    }
    const next = roman[i + 1]
    entries.push({
      content: value.content,
      start: value.time!.start,
      end: value.time!.end,
      target,
      boundary: !!next && Lyric.Common.isWordSpace(next)
    })
  }

  if (!entries.length) {
    return false
  }

  const groups = new Map<Lyric.Common.WordNormal, Lyric.Common.WordAnnotationContent[]>()
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]
    const next = entries[i + 1]

    let content = entry.content
    if (entry.boundary && next) {
      const from = indexMap.get(entry.target)
      const to = indexMap.get(next.target)
      const bodySpaced =
        from !== undefined && to !== undefined && hasWordSpaceBetween(words, from, to)
      if (!bodySpaced) {
        content += ' '
      }
    }

    const token = Lyric.Common.makeWordAnnotationContent({
      content,
      time: Lyric.Common.makeTime({ start: entry.start, end: entry.end })
    })

    const list = groups.get(entry.target)
    if (list) {
      list.push(token)
    } else {
      groups.set(entry.target, [token])
    }
  }

  let head: Lyric.Common.WordAnnotationContent | undefined
  let tail: Lyric.Common.WordAnnotationContent | undefined
  let headIndex = Infinity
  let tailIndex = -Infinity
  for (const [word, tokens] of groups) {
    const index = indexMap.get(word)
    if (index === undefined) {
      continue
    }
    if (index < headIndex) {
      headIndex = index
      head = tokens[0]
    }
    if (index > tailIndex) {
      tailIndex = index
      tail = tokens[tokens.length - 1]
    }
  }
  if (head) {
    head.content = head.content.trimStart()
  }
  if (tail) {
    tail.content = tail.content.trimEnd()
  }

  const lang = normalizeLanguage(language)
  for (const [word, tokens] of groups) {
    const item = Lyric.Common.makeWordAnnotationRoman({
      words: tokens,
      time: Lyric.Common.makeTime({
        start: tokens[0].time!.start,
        end: tokens[tokens.length - 1].time!.end
      })
    })

    if (lang) {
      item.language = lang
    }

    word.annotation ??= Lyric.Common.makeWordAnnotation()
    word.annotation.romans.push(item)
  }

  return true
}

const attachRoman = (
  blocks: Xml.XmlElement[],
  lineMap: Map<string, Lyric.Parsed.ParsedLineNormal>,
  backgroundMap: Map<string, Lyric.Parsed.ParsedLineBackground>
) => {
  eachAnnotationText(blocks, lineMap, (text, line, language) => {
    if (hasTimedSpans(text) && attachWordRomans(text, line, language)) {
      return
    }
    // separate the x-bg pieces so they land on background lines instead of the main roman.
    const { main, backgrounds } = splitBackgroundText(text)
    appendLineRoman(line, main, language)
    attachBackgroundTexts(line, backgrounds, backgroundMap, (background, content) =>
      appendLineRoman(background, content, language)
    )
  })
}

/**
 * Attach head iTunesMetadata translations and transliterations to body lines by itunes:key.
 *
 * Shared by every TTML dialect, since amll is itunes plus its own amll:meta.
 */
export const attachHeadAnnotations = (
  groups: ElementGroups,
  lineMap: Map<string, Lyric.Parsed.ParsedLineNormal>,
  backgroundMap: Map<string, Lyric.Parsed.ParsedLineBackground>
) => {
  if (!lineMap.size) {
    return
  }
  attachTranslate(groups.get('translation') ?? [], lineMap, backgroundMap)
  attachRoman(groups.get('transliteration') ?? [], lineMap, backgroundMap)
}
