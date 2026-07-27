import type { Base } from '../base'
import type { Translate } from './translate'
import type { Roman } from './roman'

export * from './translate'
export * from './roman'

/**
 * Annotation sub‑lines rendered beneath the main vocal line (translation and romanization).
 */
export interface Annotation {
  /**
   * Master switch for all annotation sub‑lines. When `false`, both `translate` and `roman` are hidden regardless of their own `visible`.
   * @default true
   */
  visible?: boolean
  /**
   * Shared base for all annotation sub‑lines; each inherits these values unless overridden.
   */
  base?: Base
  /**
   * Translation sub‑line overrides.
   */
  translate?: Translate
  /**
   * Romanization sub‑line overrides.
   */
  roman?: Roman
}
