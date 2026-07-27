import type { Script } from './constants'

import { Lyric } from '../../lyric'
import {
  SCRIPT_RANGES,
  SCRIPT_PRIORITY,
  SIMPLIFIED_SET,
  TRADITIONAL_SET,
  LATIN_FEATURE_SCORES
} from './constants'

export * from './constants'

/**
 * Languages whose share is weighted per character instead of per word.
 */
const CJK_LANGUAGES: ReadonlySet<Lyric.LanguageTag> = new Set<Lyric.LanguageTag>([
  Lyric.LanguageType.ChineseSimplified,
  Lyric.LanguageType.ChineseTraditional,
  Lyric.LanguageType.Japanese,
  Lyric.LanguageType.Korean
])

/**
 * Classify a single code point into a script, or undefined for digits, punctuation and symbols.
 */
export const classifyCodePoint = (cp: number): Script | undefined => {
  for (let i = 0, len = SCRIPT_PRIORITY.length; i < len; i++) {
    const ranges = SCRIPT_RANGES[SCRIPT_PRIORITY[i]]
    for (let j = 0; j < ranges.length; j++) {
      if (cp >= ranges[j][0] && cp <= ranges[j][1]) {
        return SCRIPT_PRIORITY[i]
      }
    }
  }
  return undefined
}

/**
 * Count characters per script across the whole text.
 */
export const analyzeScripts = (text: string): Record<Script, number> => {
  const counts: Record<Script, number> = { kana: 0, hangul: 0, han: 0, cyrillic: 0, latin: 0 }
  for (const ch of text) {
    const script = classifyCodePoint(ch.codePointAt(0)!)
    if (script) {
      counts[script]++
    }
  }
  return counts
}

/**
 * The script with the most characters; ties resolved by SCRIPT_PRIORITY.
 */
export const dominantScript = (counts: Record<Script, number>): Script | undefined => {
  let result: Script | undefined
  let max = 0
  for (let i = 0, len = SCRIPT_PRIORITY.length; i < len; i++) {
    const script = SCRIPT_PRIORITY[i]
    if (counts[script] > max) {
      result = script
      max = counts[script]
    }
  }
  return result
}

/**
 * Decide simplified vs traditional from variant-only characters; undefined when undecidable.
 */
export const detectChineseVariant = (text: string): Lyric.LanguageTag | undefined => {
  let simplified = 0
  let traditional = 0
  for (const ch of text) {
    if (SIMPLIFIED_SET.has(ch)) {
      simplified++
    } else if (TRADITIONAL_SET.has(ch)) {
      traditional++
    }
  }
  if (traditional > simplified) {
    return Lyric.LanguageType.ChineseTraditional
  }
  if (simplified > traditional) {
    return Lyric.LanguageType.ChineseSimplified
  }
  return undefined
}

/**
 * Pick the most likely Latin-script language from accumulated feature characters, English by default.
 */
export const detectLatinLanguage = (text: string): Lyric.LanguageType => {
  const scores = new Map<Lyric.LanguageType, number>()
  for (const ch of text) {
    const feature = LATIN_FEATURE_SCORES[ch]
    if (!feature) {
      continue
    }
    for (const key in feature) {
      const lang = key as Lyric.LanguageType
      scores.set(lang, (scores.get(lang) ?? 0) + (feature[lang] ?? 0))
    }
  }

  let result: Lyric.LanguageType = Lyric.LanguageType.English
  let max = 0
  for (const [lang, score] of scores) {
    if (score > max) {
      result = lang
      max = score
    }
  }
  return result
}

/**
 * Whether a language is counted per character (CJK) rather than per word.
 */
export const isCjkLanguage = (lang: Lyric.LanguageTag): boolean => {
  return CJK_LANGUAGES.has(lang)
}

/**
 * Count CJK characters (kana, hangul, han) in the text.
 */
export const countCjkChars = (text: string): number => {
  let count = 0
  for (const ch of text) {
    const script = classifyCodePoint(ch.codePointAt(0)!)
    if (script === 'kana' || script === 'hangul' || script === 'han') {
      count++
    }
  }
  return count
}

/**
 * Count Latin and Cyrillic words delimited by anything other than their letters.
 */
export const countLatinWords = (text: string): number => {
  const matches = text
    .replace(/['’]/g, '')
    .match(/[A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f\u0400-\u052f]+/g)
  return matches ? matches.length : 0
}
