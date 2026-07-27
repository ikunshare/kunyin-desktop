import * as Animation from './animation'

/**
 * Viewport scrolling behaviour driven by the active line.
 */
export interface Root {
  /**
   * Vertical anchor of the active line inside the container,
   * as a percentage (`0`–`100`) of container height.
   *
   * - `50` — keep the active line at the vertical center
   * - `30` — keep the active line closer to the top
   *
   * @default 50
   */
  anchor?: number
  /**
   * Transition animation used when the active line changes.
   *
   * `animation.mode` controls how delays are distributed across nearby lines;
   * each mode reads its own parameter sub‑object. See {@link Animation.Root}.
   *
   * @default Smooth (duration 500ms, easing "ease", delay 0)
   */
  animation?: Animation.Root
}

export { Animation }
