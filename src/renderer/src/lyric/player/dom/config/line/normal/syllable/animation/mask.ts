/**
 * Soft‑edge feather amounts for the karaoke mask wipe.
 *
 * The mask gradient extends a fade region beyond each syllable's box so the wipe transitions smoothly.
 * The first and last words use enlarged envelopes so the wipe enters and leaves without a visible cut at the edges.
 */
export interface MaskFeather {
  /**
   * Base feather size as a fraction of the syllable's font height; larger values give a softer, wider edge.
   * @default 0.5
   * @min 0
   * @max 2
   */
  normal?: number
  /**
   * Multiplier on top of `normal` for the leading envelope of the first word, softening the entry.
   * @default 1.5
   * @min 0
   * @max 5
   */
  first?: number
  /**
   * Multiplier on top of `normal` for the trailing envelope of the last word, trimming the exit.
   * @default 0.5
   * @min 0
   * @max 5
   */
  last?: number
}

/**
 * Karaoke‑style mask animation: reveals each syllable progressively from left to right, in sync with the audio.
 */
export interface Mask {
  /**
   * Whether to enable the mask animation. When disabled, syllables flip to the active style instantly instead of being wiped in.
   * @default true
   */
  enabled?: boolean
  /**
   * Soft‑edge feather sizing.
   */
  feather?: MaskFeather
}
