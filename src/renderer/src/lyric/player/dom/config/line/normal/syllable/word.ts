import type { Animation } from './animation'

/**
 * The main word text — the karaoke unit each per-word annotation row (romanization, ruby) attaches to.
 */
export interface Word {
  /**
   * Per-syllable animation effects (float / mask wipe / emphasize).
   */
  animation?: Animation
}
