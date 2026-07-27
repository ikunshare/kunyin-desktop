import type { Roman } from './roman'
import type { Ruby } from './ruby'

export * from './roman'
export * from './ruby'

export interface Annotation {
  /**
   * Horizontal gap in `px` between adjacent words that carry annotation rows; words without any row stay flush.
   * @default 3
   * @min 0
   */
  gap?: number
  /**
   * [vendor patch] Whether an annotation row always drives its own wipe timeline.
   *
   * Upstream hard-codes this to `true`, so a per-word romanization always wipes on a clock of its
   * own; when its tokens' time window differs from the word's (romanization tracks are usually off
   * by tens of ms), the syllable and the pinyin under it visibly wipe out of sync.
   *
   * With `false`, a row whose single token shares the word's window rides the word's cell mask —
   * one clock, perfectly in step — while multi-token rows (liaison) still get their own timeline,
   * which is what per-syllable wiping needs.
   *
   * @default false
   */
  forceOwnWipe?: boolean
  /**
   * Per‑word romanization following each syllable.
   */
  roman?: Roman
  /**
   * Per‑word ruby (furigana) riding above each syllable.
   */
  ruby?: Ruby
}
