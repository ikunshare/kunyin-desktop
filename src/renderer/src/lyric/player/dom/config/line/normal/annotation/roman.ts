import type { Base } from '../base'

/**
 * Romanization (e.g. pinyin) sub‑line.
 *
 * Inherits from {@link Base}; values left unset fall back to `annotation.base`.
 */
export interface Roman extends Base {
  /**
   * Whether to show the romanization line.
   * @default true
   */
  visible?: boolean
}
