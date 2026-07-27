/**
 * Blur effect applied per line.
 *
 * The active line uses `min` (sharpest); the farthest lines reach `max`
 * (most blurred).
 */
export interface Blur {
  /**
   * Whether to enable the blur effect.
   * @default true
   */
  enabled?: boolean
  /**
   * Blur radius of the active line, in `px` — the sharpest state.
   * @default 0.4
   */
  min?: number
  /**
   * Blur radius of the farthest line, in `px` — the most blurred state.
   * @default 4.5
   */
  max?: number
}
