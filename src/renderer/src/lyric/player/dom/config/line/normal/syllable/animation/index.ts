import type { Float } from './float'
import type { Mask } from './mask'
import type { Emphasize } from './emphasize'

export * from './float'
export * from './mask'
export * from './emphasize'

/**
 * Animation set applied at the syllable level.
 */
export interface Animation {
  /**
   * Vertical floating motion.
   */
  float?: Float
  /**
   * Karaoke wipe.
   */
  mask?: Mask
  /**
   * Per‑character emphasize effect for stressed syllables.
   */
  emphasize?: Emphasize
}
