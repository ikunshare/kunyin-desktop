import type { StyleConfig } from '../../common'

/**
 * Style configuration for the inactive (idle) state of an interlude indicator,
 * with an option to hide it entirely.
 */
interface NormalStyle extends StyleConfig {
  /**
   * Whether to hide the indicator in the normal (inactive) state.
   *
   * When `true`, the indicator is not show until it becomes active.
   *
   * @default true
   */
  hide?: boolean
}

/**
 * Style overrides keyed by playback state.
 *
 * - `active` represents the interlude that is currently being played.
 * - `normal` represents all other (inactive) interludes.
 *
 * Any state left unset falls back to `normal`.
 */
interface StateStyleConfig {
  /**
   * Style of inactive (idle) interludes.
   *
   * Supports an additional `hide` flag to omit rendering when inactive.
   */
  normal?: NormalStyle
  /**
   * Style of the currently active interlude.
   *
   * Falls back to `normal` if omitted.
   */
  active?: StyleConfig
}

/**
 * Root configuration for interlude (instrumental) segments.
 *
 * Interludes are rendered as a small visual indicator (e.g. a row of dots)
 * between vocal segments, rather than as text. Only the `normal` and `active`
 * playback states are meaningful for this component.
 */
export interface Root {
  /**
   * Size of the indicator (e.g. dot diameter), in pixels.
   *
   * @default 16
   */
  size?: number
  /**
   * State-based style overrides for the `normal` and `active` playback states.
   */
  style?: StateStyleConfig
}
