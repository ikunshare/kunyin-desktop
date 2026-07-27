import type { Base } from '../base'
import type { Word } from './word'
import type { Annotation } from './annotation'

export * from './animation'
export * from './word'
export * from './annotation'

export enum WordSlot {
  /**
   * The word's main text.
   */
  Word = 'word',
  /**
   * The per‑word romanization annotation that follows the word.
   */
  AnnotationRoman = 'word-roman',
  /**
   * The per‑word ruby (furigana) annotation. Reserved slot — not rendered yet.
   */
  AnnotationRuby = 'word-ruby'
}

export interface Root extends Base {
  /**
   * Top‑to‑bottom order of the word text and its per‑word annotation rows (romanization, ruby).
   * Unknown or duplicate slots are dropped and missing ones appended, so the effective value is always a full permutation.
   * @default [WordSlot.AnnotationRoman, WordSlot.Word, WordSlot.AnnotationRuby]
   */
  sort?: readonly WordSlot[]
  /**
   * The main word text and its own settings (animation).
   */
  word?: Word
  /**
   * Per‑word annotation rows (romanization, reserved ruby) and the gap they introduce between words.
   */
  annotation?: Annotation
}
