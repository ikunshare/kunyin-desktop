/**
 * Check whether any string in the collection contains the given keyword as a substring.
 *
 * Accepts both `Set<string>` and `string[]`. Performs a single pass with early exit
 * on the first match.
 *
 * @example
 * hasKeyContaining(new Set(['line.normal.base', 'effect.blur']), 'line') // true
 * hasKeyContaining(['line.normal.base', 'effect.blur'], 'line')          // true
 */
export const hasKeyContaining = (collection: Set<string> | string[], keyword: string): boolean => {
  const size = collection instanceof Set ? collection.size : collection.length
  if (size === 0) {
    return false
  }

  if (keyword === '') {
    return true
  }

  for (const key of collection) {
    if (key.includes(keyword)) {
      return true
    }
  }
  return false
}

/**
 * Check whether any string in the collection contains any of the given keywords as a substring.
 *
 * Accepts both `Set<string>` and `string[]`. Performs a single pass over the collection
 * with an inner loop over the keywords.
 *
 * For best performance, pass `keywords` as a module-level constant
 * (e.g. an `as const` array) to avoid re-allocation per call, and place
 * the most likely matches first.
 *
 * @example
 * const KEYWORDS = ['line', 'container.padding'] as const
 * hasKeyContainingAny(set, KEYWORDS)
 * hasKeyContainingAny(['line.normal.base'], KEYWORDS)
 */
export const hasKeyContainingAny = (
  collection: Set<string> | string[],
  keywords: string[]
): boolean => {
  const size = collection instanceof Set ? collection.size : collection.length
  const kLen = keywords.length
  if (size === 0 || kLen === 0) {
    return false
  }

  // Fast path: single keyword — avoid the inner loop entirely
  if (kLen === 1) {
    const keyword = keywords[0]!
    if (keyword === '') return true
    for (const key of collection) {
      if (key.includes(keyword)) return true
    }
    return false
  }

  for (const key of collection) {
    for (let i = 0; i < kLen; i++) {
      if (key.includes(keywords[i]!)) {
        return true
      }
    }
  }
  return false
}
