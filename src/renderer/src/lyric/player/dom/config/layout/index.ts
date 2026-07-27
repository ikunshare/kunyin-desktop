import type { Duet } from './duet'

export type AlignValue = 'left' | 'center' | 'right'

/**
 * Geometric layout rules applied to all lyric lines.
 */
export interface Root {
  /**
   * Horizontal alignment of lines within the container.
   * @default "left"
   */
  align?: AlignValue
  /**
   * Vertical spacing between adjacent lines, in `px`.
   * @default 30
   */
  gap?: number
  /**
   * Duet mode configuration.
   */
  duet?: Duet
}

export type { Duet }
