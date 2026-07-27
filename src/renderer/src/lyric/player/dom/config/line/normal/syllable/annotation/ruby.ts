import type { Base } from '../../base'

/**
 * Per‑word ruby (furigana) that rides above each syllable, sharing the word's wipe.
 *
 * Inherits from {@link Base}; values left unset fall back to the syllable main line.
 */
export interface Ruby extends Base {
  /**
   * Whether to show per‑word ruby.
   * @default true
   */
  visible?: boolean
}
