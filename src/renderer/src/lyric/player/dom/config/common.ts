/**
 * A pixel value used inside a {@link Padding} shorthand, e.g. `"20px"`.
 */
export type PaddingValue = `${number}px`

/**
 * CSS‑like padding shorthand, restricted to `px` units.
 *
 * Mirrors the standard CSS `padding` shorthand:
 * - 1 value : all four sides
 * - 2 values: top/bottom · left/right
 * - 3 values: top · left/right · bottom
 * - 4 values: top · right · bottom · left
 */
export type Padding =
  | PaddingValue
  | `${PaddingValue} ${PaddingValue}`
  | `${PaddingValue} ${PaddingValue} ${PaddingValue}`
  | `${PaddingValue} ${PaddingValue} ${PaddingValue} ${PaddingValue}`

/**
 * Font size: a bare number is treated as `px`, or an explicit CSS length string in `px`, `em` or `%`.
 *
 * @example 30
 * @example "1.2em"
 * @example "120%"
 */
export type FontSize = number | `${number}px` | `${number}em` | `${number}%`

/**
 * Font weight: a numeric weight (`100`–`900`), or a CSS keyword.
 *
 * @example 500
 * @example "bold"
 */
export type FontWeight = number | 'normal' | 'bold' | 'bolder' | 'lighter'

/**
 * Font appearance shared by lyric lines and their annotation sub‑lines.
 */
export interface FontConfig {
  /**
   * Font size; a bare number is treated as `px`.
   * @default 30
   */
  size?: FontSize
  /**
   * Font weight; a number in the `100`–`900` range, or a CSS keyword such as `"bold"`.
   * @default 500
   */
  weight?: FontWeight
  /**
   * CSS `font-family` value.
   * @default "sans-serif"
   * @example "'PingFang SC', 'Helvetica Neue', Arial, sans-serif"
   */
  family?: string
}

/**
 * Visual style for a single render state.
 */
export interface StyleConfig {
  /**
   * Any valid CSS color value.
   * @default "#000000"
   * @example "rgba(255, 255, 255, 0.8)"
   * @example "#333333"
   */
  color?: string
  /**
   * Opacity in the `[0, 1]` range; `1` is fully opaque.
   * @default 1
   */
  opacity?: number
}

/**
 * Style overrides keyed by playback state.
 *
 * `active` is the line currently being sung, `normal` is everything else.
 * Any state left unset falls back to `normal`.
 */
export interface StateStyleConfig {
  /**
   * Style of inactive (idle) lines.
   */
  normal?: StyleConfig
  /**
   * Style of the active line.
   * Falls back to `normal` if omitted.
   */
  active?: StyleConfig
}
