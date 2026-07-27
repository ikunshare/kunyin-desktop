import type { InsertTextSpaceTypes } from './constants'

import { Lyric } from '../lyric'
import { INSERT_TEXT_SPACE_TYPES, INSERT_TEXT_SPACE_TYPES_VALUE } from './constants'

const CJK_RANGE = '\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff' as const
const ENGLISH_RANGE = 'A-Za-z' as const
const NUMBER_RANGE = '0-9' as const
const SYMBOL_RANGE = '!@#$%^&+\\-=/|<>' as const
const ENGLISH_NUMBER_RANGE = `${ENGLISH_RANGE}${NUMBER_RANGE}` as const
const ALL_RANGE = `${ENGLISH_NUMBER_RANGE}${SYMBOL_RANGE}${CJK_RANGE}` as const

const CJK_WITH_EN_RULE = new RegExp(`([${CJK_RANGE}])([${ENGLISH_RANGE}])`, 'gu')
const EN_WITH_CJK_RULE = new RegExp(`([${ENGLISH_RANGE}])([${CJK_RANGE}])`, 'gu')
const CJK_WITH_NUM_RULE = new RegExp(`([${CJK_RANGE}])([${NUMBER_RANGE}])`, 'gu')
const NUM_WITH_CJK_RULE = new RegExp(`([${NUMBER_RANGE}])([${CJK_RANGE}])`, 'gu')

const TRIM_INSIDE_SYMBOLS_RULE = /([<\[\{\("“‘])\s*([^<>\[\]\{\}\(\)"“‘”’]*?)\s*([>\]\}\)"”’])/gu
const QUOTE_BEFORE_RULE = new RegExp(`([${CJK_RANGE}${ENGLISH_NUMBER_RANGE}])(["\`“‘])`, 'gu')
const QUOTE_AFTER_RULE = new RegExp(`(["\`”’])([${CJK_RANGE}${ENGLISH_NUMBER_RANGE}])`, 'gu')
const PUNCTUATION_RULE = new RegExp(`([${ALL_RANGE}])([!;,\\?:])(?=[${ALL_RANGE}])`, 'gu')
// remove '*' and '\'
const MATH_OPERATOR_RULE = new RegExp(`([${ALL_RANGE}])([+=&])(?=[${ALL_RANGE}])`, 'gu')
const BRACKET_OUTSIDE_BEFORE_RULE = new RegExp(
  `([${ENGLISH_NUMBER_RANGE}${CJK_RANGE}])([\\[({<])`,
  'gu'
)
const BRACKET_OUTSIDE_AFTER_RULE = new RegExp(
  `([\\])}>])([${ENGLISH_NUMBER_RANGE}${CJK_RANGE}])`,
  'gu'
)

const HYPHEN_RULE = new RegExp(
  `(?<=[${ENGLISH_NUMBER_RANGE}${CJK_RANGE}])-(?=[${ENGLISH_NUMBER_RANGE}${CJK_RANGE}])`,
  'gu'
)
const SLASH_RULE = new RegExp(
  `([${ENGLISH_NUMBER_RANGE}${CJK_RANGE}])(/)(?=[${ENGLISH_NUMBER_RANGE}${CJK_RANGE}])`,
  'gu'
)
const HYPHEN_EDGE_RULE = new RegExp(
  `(\\s|^)(-)(?=[${ENGLISH_NUMBER_RANGE}${CJK_RANGE}])|([${ENGLISH_NUMBER_RANGE}${CJK_RANGE}])(-)(?=\\s|$)`,
  'gu'
)

const applyCjkEnglish = (text: string) => {
  return text.replace(CJK_WITH_EN_RULE, '$1 $2').replace(EN_WITH_CJK_RULE, '$1 $2')
}
const applyCjkNumber = (text: string) => {
  return text.replace(CJK_WITH_NUM_RULE, '$1 $2').replace(NUM_WITH_CJK_RULE, '$1 $2')
}

const isDigit = (char: string | undefined) => char !== undefined && char >= '0' && char <= '9'

const applyPunctuation = (text: string) => {
  // a comma or colon between two digits belongs to one number or clock time, so keep it tight
  return text.replace(
    PUNCTUATION_RULE,
    (full: string, before: string, punct: string, offset: number, str: string) => {
      if (
        (punct === ',' || punct === ':') &&
        isDigit(before) &&
        isDigit(str[offset + full.length])
      ) {
        return full
      }
      return `${before}${punct} `
    }
  )
}
const applyQuote = (text: string) => {
  return text.replace(QUOTE_BEFORE_RULE, '$1 $2').replace(QUOTE_AFTER_RULE, '$1 $2')
}
const applyBracketOutside = (text: string) => {
  return text
    .replace(BRACKET_OUTSIDE_BEFORE_RULE, '$1 $2')
    .replace(BRACKET_OUTSIDE_AFTER_RULE, '$1 $2')
}
const applyMathOperator = (text: string) => {
  return text.replace(MATH_OPERATOR_RULE, '$1 $2 ')
}
const applySlash = (text: string) => {
  // a slash between two digits is a fraction or date, so keep it tight
  return text.replace(
    SLASH_RULE,
    (full: string, before: string, slash: string, offset: number, str: string) => {
      if (isDigit(before) && isDigit(str[offset + full.length])) {
        return full
      }
      return `${before} ${slash} `
    }
  )
}
const applyHyphen = (text: string) => {
  // a hyphen between two digits is a date, range or phone number, so keep it tight
  return text
    .replace(HYPHEN_RULE, (hyphen: string, offset: number, str: string) => {
      if (isDigit(str[offset - 1]) && isDigit(str[offset + 1])) {
        return hyphen
      }
      return ' - '
    })
    .replace(HYPHEN_EDGE_RULE, (m, g1, g2, g3, g4) => {
      return g1 !== undefined ? `${g1}${g2} ` : `${g3} ${g4}`
    })
}
const applyTrimInsideSymbols = (text: string) => {
  return text.replace(
    TRIM_INSIDE_SYMBOLS_RULE,
    (_, left, inner, right) => `${left.trim()}${inner.trim()}${right.trim()}`
  )
}
const applyCompressSpaces = (text: string) => {
  return text.replaceAll(/[ ]{2,}/g, ' ')
}

export const processTypes = (types?: InsertTextSpaceTypes[]) => {
  const target = types || [INSERT_TEXT_SPACE_TYPES.ALL]
  return new Set<InsertTextSpaceTypes>(
    target.includes(INSERT_TEXT_SPACE_TYPES.ALL) ? INSERT_TEXT_SPACE_TYPES_VALUE : target
  )
}

export const insertSpace = (text: string, target: Set<InsertTextSpaceTypes>) => {
  if (typeof text !== 'string' || text.trim().length === 0) {
    return text
  }

  let result = text

  if (target.has(INSERT_TEXT_SPACE_TYPES.CJK_ENGLISH)) result = applyCjkEnglish(result)
  if (target.has(INSERT_TEXT_SPACE_TYPES.CJK_NUMBER)) result = applyCjkNumber(result)

  if (target.has(INSERT_TEXT_SPACE_TYPES.PUNCTUATION)) result = applyPunctuation(result)
  if (target.has(INSERT_TEXT_SPACE_TYPES.QUOTE)) result = applyQuote(result)
  if (target.has(INSERT_TEXT_SPACE_TYPES.BRACKET_OUTSIDE)) result = applyBracketOutside(result)

  if (target.has(INSERT_TEXT_SPACE_TYPES.MATH_OPERATOR)) result = applyMathOperator(result)
  if (target.has(INSERT_TEXT_SPACE_TYPES.HYPHEN)) result = applyHyphen(result)
  if (target.has(INSERT_TEXT_SPACE_TYPES.SLASH)) result = applySlash(result)

  if (target.has(INSERT_TEXT_SPACE_TYPES.TRIM_INSIDE_SYMBOLS))
    result = applyTrimInsideSymbols(result)
  if (target.has(INSERT_TEXT_SPACE_TYPES.COMPRESS_SPACES)) result = applyCompressSpaces(result)

  return result.trim()
}

export function alignElements<T, R>(
  elements: T[],
  text: string,
  onSpaces: (count: number) => R | R[],
  onMatch: (element: T, matched: string) => R,
  getNonSpaceChars: (element: T) => string
): R[] {
  const result: R[] = []
  let pIndex = 0

  const appendSpaces = () => {
    let spaceCount = 0
    while (pIndex < text.length && text[pIndex] === ' ') {
      spaceCount++
      pIndex++
    }
    if (spaceCount > 0) {
      const spaces = onSpaces(spaceCount)
      if (Array.isArray(spaces)) result.push(...spaces)
      else result.push(spaces)
    }
  }

  for (const element of elements) {
    const nonSpaceChars = getNonSpaceChars(element)
    if (nonSpaceChars.length === 0) {
      continue
    }

    appendSpaces()

    const matchStart = pIndex
    let charIndex = 0

    while (pIndex < text.length && charIndex < nonSpaceChars.length) {
      if (text[pIndex] !== ' ') {
        charIndex++
      }
      pIndex++
    }

    result.push(onMatch(element, text.substring(matchStart, pIndex)))
  }

  appendSpaces()

  return result
}

export const insertSpaceToLine = (
  line: Lyric.Parsed.ParsedLineNormal | Lyric.Parsed.ParsedLineBackground,
  target: Set<InsertTextSpaceTypes>
): void => {
  if (!line || !line.words.length) {
    return
  }

  const full = Lyric.Common.getWordsText(line.words)
  const processed = insertSpace(full, target)

  const normalWords = line.words.filter(Lyric.Common.isWordNormal).map((w) => w.body.value)

  const newWords = alignElements<Lyric.Common.WordNormal, Lyric.Common.Word>(
    normalWords,
    processed,
    (count) => {
      return Lyric.Common.makeWordSpace({ count })
    },
    (originalWord, matchedText) => {
      return Lyric.Common.makeWordNormal({
        content: matchedText,
        time: originalWord.time,
        language: originalWord.language,
        annotation: originalWord.annotation,
        stress: originalWord.stress
      })
    },
    // strip only the literal space, matching the space notion used inside alignElements
    (w) => w.content.replaceAll(' ', '')
  )

  line.words = newWords
}

export const insertSpaceToExtended = (
  line: Lyric.Parsed.ParsedLineNormal | Lyric.Parsed.ParsedLineBackground,
  target: Set<InsertTextSpaceTypes>
): void => {
  const annotation = line.annotation
  if (!annotation) {
    return
  }
  for (const item of annotation.translations) {
    item.content = insertSpace(item.content, target)
  }
  for (const item of annotation.romans) {
    item.content = insertSpace(item.content, target)
  }
}
