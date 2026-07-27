/**
 * Properties shared by every scroll animation mode.
 */
export interface Base {
  /**
   * Transition duration of **each individual line**, in `ms`.
   *
   * In cascade modes (Ripple / Directional / Stagger), the total visual
   * duration is roughly `duration + maxDelay`, where `maxDelay` is:
   * - Ripple / Directional: `range × step`
   * - Stagger:              `2 × range × step`
   *
   * @default 500
   */
  duration?: number
  /**
   * CSS easing function for the transition.
   *
   * @default "ease"
   * @example "ease-in-out"
   * @example "cubic-bezier(0.4, 0, 0.2, 1)"
   * @example "linear"
   */
  easing?: string
}

/**
 * Scroll animation mode.
 */
export enum Mode {
  /**
   * All lines move together — no cascade. An optional fixed `delay` may be added.
   */
  Smooth = 'smooth',
  /**
   * Symmetric cascade radiating outward from the active line.
   */
  Ripple = 'ripple',
  /**
   * Asymmetric cascade: played lines move first, upcoming lines follow.
   */
  Directional = 'directional',
  /**
   * Linear, direction‑sensitive stagger (legacy).
   * Delay formula: `(range + sign × clampedOffset) × step`.
   */
  Stagger = 'stagger'
}

/**
 * Parameters for {@link Mode.Smooth} — a uniform, non‑cascade transition.
 */
export interface Smooth {
  /**
   * Fixed delay before the transition starts, in `ms`.
   * @default 0
   */
  delay?: number
}

/**
 * Parameters for {@link Mode.Ripple} — a symmetric cascade radiating outward
 * from the active line.
 */
export interface Ripple {
  /**
   * Offset (in line units) at which the per‑line delay saturates.
   * Lines with `|offset| ≥ range` all receive the maximum delay.
   *
   * @default 5
   * @minimum 1
   */
  range?: number
  /**
   * Delay increment per offset unit, in `ms`. Scales the cascade curve.
   *
   * @default 40
   * @minimum 10
   */
  step?: number
}

/**
 * Parameters for {@link Mode.Directional} — an asymmetric cascade where played
 * lines move first and upcoming lines follow.
 */
export interface Directional {
  /**
   * Offset (in line units) at which the per‑line delay saturates.
   *
   * @default 5
   * @minimum 1
   */
  range?: number
  /**
   * Delay increment per offset unit, in `ms`.
   *
   * @default 40
   * @minimum 10
   */
  step?: number
}

/**
 * Parameters for {@link Mode.Stagger} — a linear, direction‑sensitive stagger
 * cascade (legacy).
 *
 * Delay formula:
 *   `delay = (range + sign × clampedOffset) × step`
 *
 * - Forward (`played = false`):  offset increases → delay grows.
 * - Backward (`played = true`):  trend reverses.
 *
 * Output is clamped to `[0, 2 × range × step]` and is always a multiple of `step`.
 */
export interface Stagger {
  /**
   * Offset (in line units) at which the delay saturates.
   *
   * @default 4
   * @minimum 1
   */
  range?: number
  /**
   * Delay increment per offset unit, in `ms`.
   *
   * @default 50
   * @minimum 1
   */
  step?: number
}

/**
 * Viewport scroll transition animation.
 *
 * `mode` selects the active cascade strategy while every mode keeps its own
 * parameters in a dedicated sub‑object. Switching modes therefore never leaks
 * one mode's settings into another, and each mode carries its own defaults.
 *
 * Shared `duration` / `easing` (from {@link Base}) apply to every mode.
 */
export interface Root extends Base {
  /**
   * Active cascade mode. See {@link Mode}.
   *
   * - **Smooth**      — all lines move together (no cascade)
   * - **Ripple**      — symmetric cascade outward from the active line
   * - **Directional** — played lines move first, upcoming lines follow
   * - **Stagger**     — legacy linear stagger; delay saturates at `range`
   *
   * @default Mode.Smooth
   */
  mode?: Mode
  /**
   * {@link Mode.Smooth} parameters.
   */
  smooth?: Smooth
  /**
   * {@link Mode.Ripple} parameters.
   */
  ripple?: Ripple
  /**
   * {@link Mode.Directional} parameters.
   */
  directional?: Directional
  /**
   * {@link Mode.Stagger} parameters.
   */
  stagger?: Stagger
}
