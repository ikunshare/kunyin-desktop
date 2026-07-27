import type { Padding } from '../common'

import type { Fade } from './fade'

/**
 * Outer wrapper of the lyric player.
 */
export interface Root {
  /**
   * Extra CSS class appended to the wrapper element.
   * @default ""
   */
  className?: string
  /**
   * Inner padding, written as a CSS‑like shorthand restricted to `px` units.
   *
   * @default "20px"
   *
   * @example "20px"               // all sides
   * @example "20px 10px"          // top/bottom · left/right
   * @example "20px 10px 30px"     // top · left/right · bottom
   * @example "20px 10px 30px 5px" // top · right · bottom · left
   */
  padding?: Padding
  /**
   * Edge fade applied at the top/bottom of the container.
   */
  fade?: Fade
}

export type { Fade }
