import type { DeepPartial } from '../../utils'
import type { CalculateConfig } from './config'

import { DEFAULT_CONFIG } from './config'
import { ConfigManager } from '../../utils'
import { ParserPlugin, ParserContext, PluginStage } from '../../core'
import { Lyric } from '../../lyric'

import { isCjkLanguage, countCjkChars, countLatinWords } from '../utils'

export class CalculatePercent extends ParserPlugin {
  override config = new ConfigManager<CalculateConfig, DeepPartial<CalculateConfig>>(DEFAULT_CONFIG)

  override get id() {
    return 'TRANSFORM-LANGUAGE-CALCULATE-PERCENT'
  }

  override get stage() {
    return PluginStage.Post
  }

  override check(ctx: ParserContext) {
    return true
  }

  override exec(ctx: ParserContext) {
    const lines = ctx.result.lines
    if (!lines.length) {
      return
    }

    const includeBackground = this.config.current.background

    const counts = new Map<Lyric.LanguageTag, number>()
    let total = 0

    // CJK weighs per character while Latin and Cyrillic weigh per word, so letter-rich scripts do not inflate their share
    const handleLine = (
      line: Lyric.Parsed.ParsedLineNormal | Lyric.Parsed.ParsedLineBackground
    ) => {
      for (const word of line.words) {
        if (!Lyric.Common.isWordNormal(word)) {
          continue
        }
        const value = word.body.value
        if (!value.language) {
          continue
        }

        const unit = isCjkLanguage(value.language)
          ? countCjkChars(value.content)
          : countLatinWords(value.content)
        if (unit <= 0) {
          continue
        }

        counts.set(value.language, (counts.get(value.language) ?? 0) + unit)
        total += unit
      }
    }

    // background vocals are ad-libs by default, so they stay out of the language share unless opted in
    for (const line of lines) {
      if (!Lyric.Parsed.isParsedLineNormal(line)) {
        continue
      }
      const body = line.body.value
      handleLine(body)
      if (includeBackground) {
        for (const background of body.backgrounds) {
          handleLine(background)
        }
      }
    }

    if (!total) {
      return
    }

    const list: Lyric.Parsed.LanguageItem[] = []
    for (const [tag, count] of counts) {
      list.push(
        Lyric.Parsed.makeParsedLanguageItem({
          tag,
          percent: Math.round((count / total) * 10000) / 100
        })
      )
    }
    list.sort((a, b) => b.percent - a.percent)

    ctx.result.languages = list
  }
}

export type { CalculateConfig }
