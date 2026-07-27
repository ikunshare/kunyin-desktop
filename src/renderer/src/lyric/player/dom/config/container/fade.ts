/**
 * Soft fade applied at the top and bottom edges of the container,
 * easing out lines as they approach the viewport edge.
 */
export interface Fade {
  /**
   * Whether to enable the edge fade.
   * @default true
   */
  enabled?: boolean
  /**
   * Top fade range, as a percentage of container height.
   * @default "5%"
   */
  top?: `${number}%`
  /**
   * Bottom fade range, as a percentage of container height.
   * @default "10%"
   */
  bottom?: `${number}%`
}
