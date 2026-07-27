import { isPlainObject, isEqual } from 'lodash-es'

const diff = (
  prev: any,
  next: any,
  prefix: string,
  changes: Set<string>,
  includeParentPath: boolean
): void => {
  // Same reference, skip diff
  if (prev === next) {
    return
  }

  // If either side is not a plain object, mark the current path as changed
  if (!isPlainObject(prev) || !isPlainObject(next)) {
    if (prefix) changes.add(prefix)
    return
  }

  const prevKeys = Object.keys(prev)
  const nextKeys = Object.keys(next)
  const visited: Record<string, true> = {}

  for (let i = 0; i < prevKeys.length; i++) {
    const key = prevKeys[i]
    visited[key] = true
    const path = prefix ? `${prefix}.${key}` : key

    // Key was removed in `next`
    if (!Object.prototype.hasOwnProperty.call(next, key)) {
      changes.add(path)
      continue
    }

    const a = prev[key]
    const b = next[key]
    // Same reference, skip
    if (a === b) {
      continue
    }

    if (isPlainObject(a) && isPlainObject(b)) {
      if (includeParentPath) {
        // Detect child changes by comparing the Set size before and after recursion
        const sizeBefore = changes.size
        diff(a, b, path, changes, includeParentPath)
        if (changes.size > sizeBefore) {
          changes.add(path)
        }
      } else {
        diff(a, b, path, changes, includeParentPath)
      }
    } else if (isEqual(a, b)) {
      // Use deep equality for non-plain objects (arrays, Date, RegExp, Map, Set, etc.)
      // so that values with equal contents but different references are not reported as changed
      continue
    } else {
      changes.add(path)
    }
  }

  // Handle keys that were newly added in `next`
  for (let i = 0; i < nextKeys.length; i++) {
    const key = nextKeys[i]
    if (visited[key]) continue
    const path = prefix ? `${prefix}.${key}` : key
    changes.add(path)
  }
}

/**
 * Deeply compare two objects and return a set of all changed paths.
 *
 * @param prev - The previous object
 * @param next - The next object
 * @param includeParentPath - Whether to include parent paths when a child changes.
 *                            When true, all ancestor paths of a changed leaf will be included.
 *                            When false, only leaf paths are recorded.
 *
 * @example
 * const prev = { a: { b: { c: 1 } } }
 * const next = { a: { b: { c: 2 } } }
 *
 * compareObject(prev, next, false)
 * // → Set { "a.b.c" }
 *
 * compareObject(prev, next, true)
 * // → Set { "a", "a.b", "a.b.c" }
 */
export const compareObject = (prev: any, next: any, includeParentPath = true): Set<string> => {
  const changes = new Set<string>()
  diff(prev, next, '', changes, includeParentPath)
  return changes
}
