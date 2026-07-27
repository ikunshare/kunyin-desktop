import type { Lyric } from '../../../../../kit/lyric'
import type { FontConfig, StateStyleConfig, StyleConfig } from '../../common'

/**
 * State styles for a vocal lyric line.
 *
 * Extends the generic two‑state model (`normal` / `active`) with a third
 * `played` state for already‑sung lines.
 */
export interface StateStyle extends StateStyleConfig {
  /**
   * Style for already‑played lines.
   * Falls back to `normal` if omitted.
   */
  played?: StyleConfig
}

/**
 * Common appearance shared by the main vocal line and its annotation sub‑lines.
 */
export interface Base {
  /**
   * Preferred language tag for choosing among coexisting annotation contents (translation, romanization).
   * Resolved most‑specific‑first down to this base, defaulting to the player's built‑in language.
   */
  language?: Lyric.LanguageTag
  /**
   * Font appearance.
   * Falls back to a higher‑level default if omitted.
   */
  font?: FontConfig
  /**
   * State‑based style overrides.
   */
  style?: StateStyle
}
