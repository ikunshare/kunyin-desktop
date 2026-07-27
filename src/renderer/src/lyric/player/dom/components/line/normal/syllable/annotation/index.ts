import type { Lyric } from '../../../../../../../kit/lyric'
import type { ComponentContext } from '../../../../context'
import type { WordAnnotationElement } from './base'

import { DomLyricPlayerConfig } from '../../../../../config'
import { WordRomanElement } from './roman'
import { WordRubyElement } from './ruby'

import { resolveLanguage } from '../../../../../utils'

export interface WordAnnotationDescriptor {
  readonly type: DomLyricPlayerConfig.Line.Normal.Syllable.WordSlot

  /**
   * Whether the annotation is turned on for the given syllable config.
   */
  isEnabled(
    syllable: DomLyricPlayerConfig.RootRequired['line']['normal']['main']['syllable']
  ): boolean

  /**
   * Resolve the preferred language for this row, or `undefined` when the row has no language choice (ruby).
   */
  buildLanguage(
    normal: DomLyricPlayerConfig.RootRequired['line']['normal']
  ): Lyric.LanguageTag | undefined

  /**
   * Build the row element for a word.
   */
  buildElement(
    context: ComponentContext,
    wordInfo: Lyric.Common.WordNormal,
    lineInfo: Lyric.Parsed.ParsedLineContent,
    language: Lyric.LanguageTag | undefined,
    forceOwnWipe?: boolean
  ): WordAnnotationElement
}

export const WORD_ANNOTATION_DESCRIPTORS: readonly WordAnnotationDescriptor[] = [
  {
    type: DomLyricPlayerConfig.Line.Normal.Syllable.WordSlot.AnnotationRoman,
    isEnabled: (syllable) => syllable.annotation.roman.visible,
    buildLanguage: (cfg) =>
      resolveLanguage(
        cfg.main.syllable.annotation.roman.language,
        cfg.annotation.roman.language,
        cfg.base.language
      ),
    buildElement: (context, info, lineInfo, language, forceOwnWipe) =>
      new WordRomanElement(context, info, lineInfo, language, forceOwnWipe)
  },
  {
    type: DomLyricPlayerConfig.Line.Normal.Syllable.WordSlot.AnnotationRuby,
    isEnabled: (syllable) => syllable.annotation.ruby.visible,
    buildLanguage: () => undefined,
    buildElement: (context, info, lineInfo, _language, forceOwnWipe) =>
      new WordRubyElement(context, info, lineInfo, forceOwnWipe)
  }
]

export * from './base'

export * from './roman'

export * from './ruby'
