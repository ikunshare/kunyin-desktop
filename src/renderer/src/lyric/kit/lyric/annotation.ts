import type {
  LineAnnotation,
  ParsedLineBackground,
  ParsedLineNormal,
  Word
} from 'music-lyric-model'
import {
  deriveParsedLineRomans,
  deriveParsedLineUnknowns,
  makeLineAnnotation
} from 'music-lyric-model'

/**
 * Ensure a line has an annotation object and return it.
 */
const ensureAnnotation = (line: ParsedLineNormal | ParsedLineBackground): LineAnnotation => {
  return line.annotation ?? (line.annotation = makeLineAnnotation())
}

/**
 * Refresh a line's derived annotations (romans, unknowns) from its word-level annotations.
 *
 * Fills empty lists from words while preserving any already-set items.
 * Word-level ruby has no line-level counterpart and is intentionally dropped.
 */
export const refreshLineAnnotation = (line: ParsedLineNormal | ParsedLineBackground): void => {
  const words: Word[] = line.words
  if (!words.length) {
    return
  }

  const annotation = ensureAnnotation(line)

  if (!annotation.romans.length) {
    annotation.romans = deriveParsedLineRomans(words)
  }
  if (!annotation.unknowns.length) {
    annotation.unknowns = deriveParsedLineUnknowns(words)
  }
}
