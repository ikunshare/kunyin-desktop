import type { Lyric } from '../../../../../../kit/lyric'
import type { AnnotationBaseElement } from './base'

import { DomLyricPlayerConfig } from '../../../../config'
import { AnnotationTranslateElement } from './translate'
import { AnnotationRomanElement } from './roman'

import { resolveLanguage } from '../../../../utils'

export interface AnnotationDescriptor {
  /**
   * Layout slot this annotation occupies within a line.
   */
  readonly slot: DomLyricPlayerConfig.Line.Normal.LineSlot
  /**
   * Whether the annotation is turned on for the given annotation config.
   */
  isEnabled(annotation: DomLyricPlayerConfig.RootRequired['line']['normal']['annotation']): boolean
  /**
   * Resolve the preferred language for this row from its own setting down to the line base.
   */
  language(normal: DomLyricPlayerConfig.RootRequired['line']['normal']): Lyric.LanguageTag
  /**
   * Build the row element for a line.
   */
  create(info: Lyric.Parsed.ParsedLineContent, language: Lyric.LanguageTag): AnnotationBaseElement
}

export const ANNOTATION_DESCRIPTORS: readonly AnnotationDescriptor[] = [
  {
    slot: DomLyricPlayerConfig.Line.Normal.LineSlot.AnnotationTranslate,
    isEnabled: (annotation) => annotation.translate.visible,
    language: (normal) =>
      resolveLanguage(normal.annotation.translate.language, normal.base.language),
    create: (info, language) => new AnnotationTranslateElement(info, language)
  },
  {
    slot: DomLyricPlayerConfig.Line.Normal.LineSlot.AnnotationRoman,
    isEnabled: (annotation) => annotation.roman.visible,
    language: (normal) => resolveLanguage(normal.annotation.roman.language, normal.base.language),
    create: (info, language) => new AnnotationRomanElement(info, language)
  }
]

export { AnnotationBaseElement } from './base'

export { AnnotationTranslateElement } from './translate'

export { AnnotationRomanElement } from './roman'
