import type { Base } from '../../base'

/**
 * Per‑word romanization that follows each syllable, sharing the word's wipe.
 *
 * Inherits from {@link Base}; values left unset fall back to the syllable main line.
 */
export interface Roman extends Base {
  /**
   * Whether to show per‑word romanization.
   * When off — or when a line carries no per‑word romanization — the line falls back to its annotation romanization row.
   * @default true
   */
  visible?: boolean
}
