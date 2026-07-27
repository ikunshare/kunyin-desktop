import { mergeWith } from 'lodash-es'

/**
 * Customizer that overwrites arrays wholesale instead of merging them by index.
 */
const overwriteArray = (_target: unknown, source: unknown): unknown[] | undefined => {
  return Array.isArray(source) ? source : undefined
}

/**
 * Deep-merge a source object into the target, replacing arrays wholesale rather than merging them by index.
 */
export const mergeObject = <T>(target: T, source: unknown): T => {
  return mergeWith(target, source, overwriteArray)
}
