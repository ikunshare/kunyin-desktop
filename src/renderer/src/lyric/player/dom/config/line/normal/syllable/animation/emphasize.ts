/**
 * The core per‑character emphasize transform: a scale pulse plus a small outward fan‑out and upward lift.
 * Glow and float are layered on top of this.
 */
export interface EmphasizeMain {
  /**
   * Whether the main transform animation runs.
   * @default true
   */
  enabled?: boolean
  /**
   * Peak scale increment; the character's peak scale is `1 + scale * intensity`, where `intensity` is derived from the syllable's duration.
   * @default 0.1
   * @min 0
   */
  scale?: number
  /**
   * Peak outward horizontal shift per character, in `px`. Characters fan out from the word's center; the center character stays put.
   * @default 1
   * @min 0
   */
  offsetHorizontal?: number
  /**
   * Peak upward vertical shift, in `px`, applied uniformly to every character.
   * @default 1
   * @min 0
   */
  offsetVertical?: number
  /**
   * CSS easing applied from offset `0` to the peak at `0.5`.
   * @default "cubic-bezier(0.2, 0.4, 0.58, 1)"
   */
  easingRise?: string
  /**
   * CSS easing applied from the peak at `0.5` back to rest at `1`.
   * @default "cubic-bezier(0.3, 0, 0.58, 1)"
   */
  easingFall?: string
}

/**
 * Glow halo rendered behind emphasized characters.
 *
 * Implemented with `text-shadow`, which can't be promoted to a compositor layer and so repaints each animated frame.
 * That is why the glow is the only sub‑effect that defaults to **off** — enable it for richer visuals, leave it off on low‑end devices.
 */
export interface EmphasizeGlow {
  /**
   * Whether to render the glow.
   * @default false
   */
  enabled?: boolean
  /**
   * Glow color, any CSS color the project's parser accepts (`#rrggbb` / `#rgb` / `rgb(...)` / `rgba(...)`).
   * An unparseable string (e.g. empty) silently disables the glow, acting as a soft kill switch.
   * @default "#000000"
   */
  color?: string
  /**
   * CSS easing applied from offset `0` to the peak at `0.5`.
   * @default "cubic-bezier(0.2, 0.4, 0.58, 1)"
   */
  easingRise?: string
  /**
   * CSS easing applied from the peak at `0.5` back to rest at `1`.
   * @default "cubic-bezier(0.3, 0, 0.58, 1)"
   */
  easingFall?: string
  /**
   * Maximum glow radius, in `px`. The runtime further clamps it by the duration‑derived intensity so short syllables get a tighter halo.
   * @default 9
   * @min 0
   */
  maxRadius?: number
  /**
   * Peak glow alpha in the `[0, 1]` range.
   * @default 1
   * @min 0
   * @max 1
   */
  maxAlpha?: number
}

/**
 * Timing controls for the secondary float layer.
 */
export interface EmphasizeFloatDuration {
  /**
   * Float duration as a multiple of the main emphasize duration. Values > 1 make the float linger after the main effect settles.
   * @default 1.4
   * @min 0
   */
  scale?: number
  /**
   * Milliseconds the float starts before the main emphasize effect.
   * @default 400
   * @min 0
   */
  lead?: number
}

/**
 * Amplified float for background lines, layered on the emphasize float.
 */
export interface EmphasizeFloatBackground {
  /**
   * Whether background lines get an amplified float.
   * @default true
   */
  enabled?: boolean
  /**
   * Float amplitude multiplier applied on background lines.
   * @default 2
   * @min 0
   */
  scale?: number
}

/**
 * Secondary sine‑wave float layered on top of the per‑word float animation.
 *
 * Stacks via `composite: add`, so it adds to rather than replaces the outer float.
 */
export interface EmphasizeFloat {
  /**
   * Whether to enable the secondary float.
   * @default true
   */
  enabled?: boolean
  /**
   * Float timing.
   */
  duration?: EmphasizeFloatDuration
  /**
   * Peak upward displacement, in `px`.
   * @default 2
   * @min 0
   */
  amplitude?: number
  /**
   * CSS easing applied to each half of the sine‑wave approximation.
   * @default "cubic-bezier(0.45, 0, 0.55, 1)"
   */
  easing?: string
  /**
   * Amplified float for background lines.
   */
  background?: EmphasizeFloatBackground
}

/**
 * The independently togglable sub‑effects that compose the emphasize animation.
 * The per‑character DOM split happens as long as at least one is enabled.
 */
export interface EmphasizeEffects {
  /**
   * Main per‑character transform.
   */
  main?: EmphasizeMain
  /**
   * Glow halo.
   */
  glow?: EmphasizeGlow
  /**
   * Secondary float layer.
   */
  float?: EmphasizeFloat
}

/**
 * Apple‑Music‑style emphasize effect for stressed syllables.
 *
 * Each character of a stressed word becomes its own span animated with up to three sub‑effects (main transform, glow, secondary float).
 * At least one sub‑effect must be enabled for the per‑character split to happen.
 */
export interface Emphasize {
  /**
   * Master switch for the entire emphasize feature.
   * @default true
   */
  enabled?: boolean
  /**
   * Sub‑effects.
   */
  effects?: EmphasizeEffects
  /**
   * Minimum animation duration in milliseconds; shorter syllables still emphasize but their timeline lasts at least this long.
   * @default 1000
   * @min 0
   */
  minDuration?: number
  /**
   * Playback rate used to wind down a per‑character animation still in flight when the line leaves the active state.
   * Higher values finish the residual peak / glow faster so it doesn't drag into the next line.
   * @default 4
   * @min 1
   */
  disablePlaybackRate?: number
}
