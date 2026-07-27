import type { Base } from '../base'

/**
 * Translation sub‑line.
 *
 * Inherits from {@link Base}; values left unset fall back to `annotation.base`.
 */
export interface Translate extends Base {
  /**
   * Whether to show the translation line.
   * @default true
   */
  visible?: boolean
}
