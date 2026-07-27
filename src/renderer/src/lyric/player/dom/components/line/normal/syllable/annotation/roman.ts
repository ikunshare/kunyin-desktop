import type { Lyric } from '../../../../../../../kit/lyric'
import type { ComponentContext } from '../../../../context'

import { PlayerRole } from '../../../../../constants'

import { WordAnnotationBaseElement } from './base'

import styles from './index.module.scss'

export class WordRomanElement extends WordAnnotationBaseElement {
  constructor(
    context: ComponentContext,
    wordInfo: Lyric.Common.WordNormal,
    lineInfo: Lyric.Parsed.ParsedLineContent,
    language: Lyric.LanguageTag | undefined,
    forceOwnWipe?: boolean
  ) {
    super(
      context,
      wordInfo,
      lineInfo,
      language,
      PlayerRole.line.normal.text.word.roman,
      styles.wordRoman,
      forceOwnWipe
    )
  }

  protected override resolve(
    info: Lyric.Common.WordNormal,
    language: Lyric.LanguageTag | undefined
  ) {
    const romans = info.annotation?.romans
    if (!romans || romans.length === 0) {
      return undefined
    }
    // Prefer the item matching the resolved language, mirroring the line-level `first(kind, language)` fallback to the first.
    const matched = language ? romans.find((item) => item.language === language) : undefined
    return matched ?? romans[0]
  }
}
