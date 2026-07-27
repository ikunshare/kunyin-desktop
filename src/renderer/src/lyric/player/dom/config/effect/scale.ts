/**
 * Scale (zoom) effect applied per line.
 *
 * The active line uses `max`; the farthest lines collapse to `min`.
 */
export interface Scale {
  /**
   * Whether to enable the scale effect.
   * @default false
   */
  enabled?: boolean
  /**
   * Scale ratio of the farthest line.
   * @default 0.65
   */
  min?: number
  /**
   * Scale ratio of the active line.
   * @default 1
   */
  max?: number
}
