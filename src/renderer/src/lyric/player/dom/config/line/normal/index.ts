import type { Base } from './base'
import type { Main } from './main'
import type { Annotation } from './annotation'

export * from './base'
export * from './main'
export * from './annotation'
export * as Syllable from './syllable'

/**
 * Renderable rows of a vocal line, used by {@link Root.sort} to lay them out top‑to‑bottom.
 */
export enum LineSlot {
  /**
   * The main vocal line (syllable or plain text).
   */
  Main = 'main',
  /**
   * The translation annotation row.
   */
  AnnotationTranslate = 'annotation-translate',
  /**
   * The romanization annotation row.
   */
  AnnotationRoman = 'annotation-roman'
}

/**
 * Configuration for vocal lyric lines.
 */
export interface Root {
  /**
   * Top‑to‑bottom order of the main vocal line and its annotation rows.
   * Only reorders; visibility stays governed by {@link Annotation} flags, and the main line is always shown.
   * Unknown or duplicate slots are dropped and any missing slot is appended in canonical order, so the effective value is always a full permutation.
   * @default [LineSlot.AnnotationRoman, LineSlot.Main, LineSlot.AnnotationTranslate]
   */
  sort?: readonly LineSlot[]
  /**
   * Base appearance shared by the main line and, as the root fallback, its annotation rows.
   */
  base?: Base
  /**
   * Main vocal line: rendering mode and per‑mode settings.
   */
  main?: Main
  /**
   * Annotation sub‑lines (translation / romanization).
   */
  annotation?: Annotation
}
