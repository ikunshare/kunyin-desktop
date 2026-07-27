import type { MatchItem } from './utils'

import { Lyric } from '../../lyric'
import { removeTextSpaceToOne } from '../../utils'
import { parseTagTime, processTextToWords } from './utils'

const TIME_CONTENT_REGXP = /(<[^>]+>)([^<]*)/gu
const TIME_TAG_2 = /<([0-9]+),([0-9]+)\>/

const SYLLABLE_CHECK_REGXP = /<[^>]+>/

const CORE_CHAR_REGEXP = /[\p{L}\p{N}]/u

const NUMBER_CONNECTORS = new Set([':', '.', ',', '/', '-'])

const hasCoreChar = (text: string) => CORE_CHAR_REGEXP.test(text)

const isDigitChar = (char: string | undefined) => char !== undefined && char >= '0' && char <= '9'

/**
 * Get the trailing run of punctuation characters of a string.
 *
 * Punctuation here means a non-core, non-space character.
 */
const getTrailingPunct = (text: string) => {
  let index = text.length
  while (index > 0) {
    const char = text[index - 1]
    if (char === ' ' || CORE_CHAR_REGEXP.test(char)) {
      break
    }
    index--
  }
  return text.slice(index)
}

/**
 * Get the leading run of punctuation characters of a string.
 *
 * Punctuation here means a non-core, non-space character.
 */
const getLeadingPunct = (text: string) => {
  let index = 0
  while (index < text.length) {
    const char = text[index]
    if (char === ' ' || CORE_CHAR_REGEXP.test(char)) {
      break
    }
    index++
  }
  return text.slice(0, index)
}

/**
 * Normalize punctuation that lands on a syllable boundary between two adjacent words.
 *
 * A numeric connector flanked by digits merges into one word whether it is attached or standalone, e.g. 10: 30 and 10 : 30 both become 10:30.
 *
 * Any other boundary punctuation splits into its own word, e.g. hello, and world become hello , world.
 */
const normalizeBoundaryPunct = (words: Lyric.Common.Word[]): Lyric.Common.Word[] => {
  const result: Lyric.Common.Word[] = []

  for (let index = 0; index < words.length; index++) {
    const word = words[index]
    const prev = result[result.length - 1]

    if (!Lyric.Common.isWordNormal(word) || !prev || !Lyric.Common.isWordNormal(prev)) {
      result.push(word)
      continue
    }

    const wordValue = word.body.value
    const prevValue = prev.body.value

    // a standalone numeric connector between two digit words joins them, e.g. 10 : 30 becomes 10:30
    const isNumberConnector =
      wordValue.content.length > 0 &&
      [...wordValue.content].every((char) => NUMBER_CONNECTORS.has(char))
    if (isNumberConnector) {
      const next = words[index + 1]
      const nextValue = next && Lyric.Common.isWordNormal(next) ? next.body.value : undefined
      const joinable =
        isDigitChar(prevValue.content[prevValue.content.length - 1]) &&
        !!nextValue &&
        isDigitChar(nextValue.content[0])

      if (joinable && nextValue) {
        prevValue.content += wordValue.content + nextValue.content
        if (prevValue.time && nextValue.time) {
          prevValue.time.end = nextValue.time.end
        }
        index++
        continue
      }

      result.push(word)
      continue
    }

    // only two core bearing words can carry boundary punctuation to normalize
    if (!hasCoreChar(prevValue.content) || !hasCoreChar(wordValue.content)) {
      result.push(word)
      continue
    }

    const trailing = getTrailingPunct(prevValue.content)
    const leading = getLeadingPunct(wordValue.content)
    if (!trailing && !leading) {
      result.push(word)
      continue
    }

    const leftCore = prevValue.content.slice(0, prevValue.content.length - trailing.length)
    const rightCore = wordValue.content.slice(leading.length)

    const leftFlank = leftCore[leftCore.length - 1]
    const rightFlank = rightCore[0]

    const punct = trailing + leading

    const isNumberJoin =
      isDigitChar(leftFlank) &&
      isDigitChar(rightFlank) &&
      [...punct].every((char) => NUMBER_CONNECTORS.has(char))
    if (isNumberJoin) {
      prevValue.content += wordValue.content
      if (prevValue.time && wordValue.time) {
        prevValue.time.end = wordValue.time.end
      }
      continue
    }

    prevValue.content = leftCore

    const start = trailing ? prevValue.time?.start : wordValue.time?.start
    const end = leading ? wordValue.time?.end : prevValue.time?.end
    const punctTime =
      start !== void 0 && end !== void 0 ? Lyric.Common.makeTime({ start, end }) : void 0
    result.push(Lyric.Common.makeWordNormal({ content: punct, time: punctTime }))

    wordValue.content = rightCore
    result.push(word)
  }

  return result
}

const processNormal = (lines: MatchItem[]) => {
  const result: Lyric.Parsed.ParsedLine[] = []
  for (const line of lines) {
    const time = parseTagTime(line.tag) || 0
    const text = line.content.trim()

    const item = Lyric.Parsed.makeParsedLineNormal({
      words: processTextToWords(text),
      time: Lyric.Common.makeTime({ start: time })
    })

    result.push(item)
  }

  for (let index = 0; index < result.length; index++) {
    const current = Lyric.Parsed.getParsedLineTime(result[index])
    const next = result[index + 1] ? Lyric.Parsed.getParsedLineTime(result[index + 1]) : undefined
    if (!current || !next) continue
    current.end = next.start
  }

  return result
}

const processSyllableLine = (line: MatchItem) => {
  const words: Lyric.Common.Word[] = []

  const lineTime = parseTagTime(line.tag)
  if (lineTime === null) {
    return null
  }

  for (const wordInfo of line.content.matchAll(TIME_CONTENT_REGXP)) {
    const timeTag = wordInfo[1] || ''

    let time = parseTagTime(timeTag)
    let duration = 0

    if (time === null) {
      const matchs = timeTag.match(TIME_TAG_2)
      if (matchs) {
        time = lineTime + (parseInt(matchs[1]) || 0)
        duration = parseInt(matchs[2]) || 0
      }
    }

    if (time === null) {
      continue
    }

    const content = wordInfo[2] || ''
    if (!content) {
      continue
    }

    const trimed = content.trim()
    if (!trimed || content.startsWith(' ')) {
      if (words.length < 1) {
        continue
      }
      const current = words[words.length - 1]
      if (!current || !Lyric.Common.isWordSpace(current)) {
        words.push(Lyric.Common.makeWordSpace({ count: 1 }))
      }
    }

    if (!trimed) {
      continue
    }

    const item = Lyric.Common.makeWordNormal({
      time: Lyric.Common.makeTime({ start: time, end: time + duration }),
      content: removeTextSpaceToOne(content)
    })
    words.push(item)

    if (content.endsWith(' ')) {
      words.push(Lyric.Common.makeWordSpace({ count: 1 }))
    }
  }

  const normalized = normalizeBoundaryPunct(words)

  let first: Lyric.Common.WordNormal | null = null
  let last: Lyric.Common.WordNormal | null = null
  for (const word of normalized) {
    if (!Lyric.Common.isWordNormal(word)) {
      continue
    }
    if (!first) {
      first = word.body.value
    }
    last = word.body.value
  }

  const start = first?.time?.start ?? lineTime
  const end = last?.time?.end ?? start

  const target = Lyric.Parsed.makeParsedLineNormal({
    words: normalized,
    time: Lyric.Common.makeTime({ start, end })
  })

  return target
}

const processSyllable = (lines: MatchItem[]) => {
  const result: Lyric.Parsed.ParsedLine[] = []
  for (const line of lines) {
    const item = processSyllableLine(line)
    if (!item) continue
    result.push(item)
  }

  return result
}

export const checkIsSyllable = (content: MatchItem[]) => {
  return content.some((line) => SYLLABLE_CHECK_REGXP.test(line.content))
}

export const processLines = (
  content: MatchItem[],
  forceNormal = false
): Lyric.Parsed.ParsedLine[] => {
  if (!content.length) {
    return []
  }

  if (!forceNormal && checkIsSyllable(content)) {
    return processSyllable(content)
  }

  return processNormal(content)
}
