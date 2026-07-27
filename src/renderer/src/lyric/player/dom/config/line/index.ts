import * as Interlude from './interlude'

import * as Normal from './normal'

/**
 * Lyric line configuration.
 *
 * Splits into:
 * - {@link Normal}    — vocal lines (with optional translation / romanization)
 * - {@link Interlude} — instrumental gaps between vocal segments
 */
export interface Root {
  /**
   * Extra CSS class appended to every line wrapper.
   * @default ""
   */
  className?: string
  /**
   * Number of lines on each side of the active line that keep their per-line animations built and stay promoted to a compositor layer.
   * Larger values reduce pops when the active line changes quickly, at the cost of more simultaneous animations and layers.
   * @default 2
   * @min 0
   */
  animationWindow?: number
  /**
   * Minimum number of lines on each side of the active line whose heavy content (words, per-word annotations, masks) is built.
   * Lines outside this band keep no DOM at all, cutting memory and CPU on long songs; it is widened automatically to at least cover the viewport.
   * @default 6
   * @min 0
   */
  contentWindow?: number
  /**
   * Vocal line configuration.
   */
  normal?: Normal.Root
  /**
   * Interlude (instrumental) line configuration.
   */
  interlude?: Interlude.Root
}

export { Normal, Interlude }
