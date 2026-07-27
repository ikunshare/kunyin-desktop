/**
 * Vertical float animation for syllables: each syllable lifts gently from `from` to `to` (in `px`) during playback, adding subtle motion in sync with the audio.
 */
export interface Float {
  /**
   * Whether to enable the float animation.
   * @default true
   */
  enabled?: boolean
  /**
   * Starting vertical offset relative to the syllable's natural position, in `px` (negative moves up).
   * @default 0
   */
  from?: number
  /**
   * Ending vertical offset relative to the syllable's natural position, in `px` (negative moves up).
   * @default 2
   */
  to?: number
}
