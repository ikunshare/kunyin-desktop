import { Scale } from './scale'
import { Blur } from './blur'

/**
 * Visual effects whose intensity depends on distance from the active line.
 *
 * Lines closer to the active one keep their natural look; lines farther away
 * progressively shrink and/or blur.
 */
export interface Root {
  /**
   * Scale (zoom) effect.
   */
  scale?: Scale
  /**
   * Blur effect.
   */
  blur?: Blur
}

export type { Scale, Blur }
