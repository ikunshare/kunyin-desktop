import { LineSlot } from '../config/line/normal'
import { WordSlot } from '../config/line/normal/syllable'

export const DEFAULT_SORT: LineSlot[] = [
  LineSlot.AnnotationRoman,
  LineSlot.Main,
  LineSlot.AnnotationTranslate
]

export const DEFAULT_WORD_SORT: WordSlot[] = [
  WordSlot.AnnotationRoman,
  WordSlot.Word,
  WordSlot.AnnotationRuby
]

/**
 * Normalize a partial order into a full permutation of `canonical`.
 * Keeps the requested order for known, non‑duplicate entries, then appends any missing ones in canonical order.
 */
const resolveOrder = <T>(sort: readonly T[] | undefined, canonical: readonly T[]): T[] => {
  const seen = new Set<T>()
  const result: T[] = []
  for (const item of sort ?? []) {
    if (canonical.includes(item) && !seen.has(item)) {
      seen.add(item)
      result.push(item)
    }
  }
  for (const item of canonical) {
    if (!seen.has(item)) {
      result.push(item)
    }
  }
  return result
}

/**
 * Resolve the top‑to‑bottom order of a vocal line's rows (main / annotations).
 */
export const resolveSort = (sort: readonly LineSlot[] | undefined): LineSlot[] =>
  resolveOrder(sort, DEFAULT_SORT)

/**
 * Resolve the top‑to‑bottom order of a word's units (main text / romanization).
 */
export const resolveWordSort = (sort: readonly WordSlot[] | undefined): WordSlot[] =>
  resolveOrder(sort, DEFAULT_WORD_SORT)
