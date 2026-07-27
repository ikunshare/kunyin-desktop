import type { DeepPartial } from '../../utils'
import type { InferConfig } from './config'
import type { Script } from '../utils'

import { DEFAULT_CONFIG } from './config'
import { ConfigManager } from '../../utils'
import { ParserPlugin, ParserContext, PluginStage } from '../../core'
import { Lyric } from '../../lyric'
import { JAPANESE_KANA_RATIO } from '../utils'

import { analyzeScripts, dominantScript, detectChineseVariant, detectLatinLanguage } from '../utils'

export class Infer extends ParserPlugin {
  override config = new ConfigManager<InferConfig, DeepPartial<InferConfig>>(DEFAULT_CONFIG)

  override get id() {
    return 'TRANSFORM-LANGUAGE-INFER'
  }

  override get stage() {
    return PluginStage.Transform
  }

  override check(ctx: ParserContext) {
    return true
  }

  override exec(ctx: ParserContext) {
    const lines = ctx.result.lines
    if (!lines.length) {
      return
    }

    const override = this.config.current.override

    const targets: { word: Lyric.Common.WordNormal; script: Script }[] = []
    let kanaCount = 0
    let hanCount = 0
    let hanText = ''
    let latinText = ''

    // first pass: resolve each word's dominant script and gather document-level signals
    const handleLine = (
      line: Lyric.Parsed.ParsedLineNormal | Lyric.Parsed.ParsedLineBackground
    ) => {
      for (const word of line.words) {
        if (!Lyric.Common.isWordNormal(word)) {
          continue
        }
        const value = word.body.value
        if (value.language && !override) {
          continue
        }

        const counts = analyzeScripts(value.content)
        const script = dominantScript(counts)
        if (!script) {
          continue
        }

        kanaCount += counts.kana
        hanCount += counts.han
        if (script === 'han') {
          hanText += value.content
        } else if (script === 'latin') {
          latinText += value.content
        }

        targets.push({ word: value, script })
      }
    }

    for (const line of lines) {
      if (!Lyric.Parsed.isParsedLineNormal(line)) {
        continue
      }
      const body = line.body.value
      handleLine(body)
      for (const background of body.backgrounds) {
        handleLine(background)
      }
    }

    // kana presence marks a Japanese document, so its han characters are Japanese rather than Chinese
    const japanese = kanaCount > 0 && kanaCount >= (kanaCount + hanCount) * JAPANESE_KANA_RATIO
    const hanLanguage = japanese
      ? Lyric.LanguageType.Japanese
      : (detectChineseVariant(hanText) ?? Lyric.LanguageType.ChineseSimplified)
    const latinLanguage = detectLatinLanguage(latinText)

    // second pass: apply the resolved language to every collected word
    for (let i = 0, len = targets.length; i < len; i++) {
      const { word, script } = targets[i]
      switch (script) {
        case 'kana':
          word.language = Lyric.LanguageType.Japanese
          break
        case 'hangul':
          word.language = Lyric.LanguageType.Korean
          break
        case 'cyrillic':
          word.language = Lyric.LanguageType.Russian
          break
        case 'han':
          word.language = hanLanguage
          break
        case 'latin':
          word.language = latinLanguage
          break
      }
    }
  }
}

export type { InferConfig }
