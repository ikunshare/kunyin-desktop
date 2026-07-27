import { ParserContext, ParserPlugin, PluginStage } from '../../core'
import { Lyric } from '../../lyric'

import { alignNumberArray } from '../../utils'
import { matchLyric } from './utils'
import { processLines, checkIsSyllable } from './line'
import { processMetas } from './meta'

const CHECK_REGEXP = /\[(?:\d+:)?(?:\d+:)?\d+\.\d+\]/

export class Parser extends ParserPlugin {
  override get id() {
    return 'LRC-PARSER'
  }

  override get stage() {
    return PluginStage.Process
  }

  override get format() {
    return 'lrc'
  }

  private processExtended(
    lines: Lyric.Parsed.ParsedLine[],
    inputTranslate: string,
    inputRoman: string
  ) {
    const lineMap: Map<number, Lyric.Parsed.ParsedLineNormal> = new Map()
    const translateMap: Map<number, Lyric.Common.LineAnnotationTranslation[]> = new Map()
    const romanMap: Map<number, Lyric.Common.LineAnnotationRoman[]> = new Map()

    for (const line of lines) {
      if (!Lyric.Parsed.isParsedLineNormal(line)) {
        continue
      }
      const time = line.body.value.time
      if (!time) {
        continue
      }
      lineMap.set(time.start, line.body.value)
    }

    if (inputTranslate) {
      const translate = processLines(matchLyric(inputTranslate).line, true)
      for (const item of translate) {
        if (!Lyric.Parsed.isParsedLineNormal(item)) {
          continue
        }
        const time = item.body.value.time
        if (!time) {
          continue
        }
        const current = translateMap.get(time.start) || []
        current.push(
          Lyric.Common.makeLineAnnotationTranslation({
            content: Lyric.Parsed.getParsedLineText(item)
          })
        )
        translateMap.set(time.start, current)
      }
    }

    if (inputRoman) {
      const roman = processLines(matchLyric(inputRoman).line, true)
      for (const item of roman) {
        if (!Lyric.Parsed.isParsedLineNormal(item)) {
          continue
        }
        const time = item.body.value.time
        if (!time) {
          continue
        }
        const current = romanMap.get(time.start) || []
        current.push(
          Lyric.Common.makeLineAnnotationRoman({ content: Lyric.Parsed.getParsedLineText(item) })
        )
        romanMap.set(time.start, current)
      }
    }

    const targets = [...new Set([...translateMap.keys(), ...romanMap.keys()])]
    const result = alignNumberArray([...lineMap.keys()], targets)
    for (const item of result) {
      const line = lineMap.get(item.base)
      if (!line) {
        continue
      }

      const translates: Lyric.Common.LineAnnotationTranslation[] = []
      const romans: Lyric.Common.LineAnnotationRoman[] = []
      for (const target of item.targets) {
        translates.push(...(translateMap.get(target.value) || []))
        romans.push(...(romanMap.get(target.value) || []))
      }

      if (!translates.length && !romans.length) {
        continue
      }

      const annotation = line.annotation ?? (line.annotation = Lyric.Common.makeLineAnnotation())
      annotation.translations.push(...translates)
      annotation.romans.push(...romans)
    }
  }

  override check(ctx: ParserContext) {
    const input = ctx.params.content
    if (!input.original) {
      return false
    }

    return CHECK_REGEXP.test(input.original)
  }

  override exec(ctx: ParserContext) {
    const input = ctx.params.content
    if (!input.original) {
      return
    }

    const match = matchLyric(input.original)
    if (!match.line.length) {
      return
    }

    const lines = processLines(match.line)
    if (!lines.length) {
      ctx.result.type = Lyric.Parsed.InfoType.VALID
      return
    }

    this.processExtended(lines, input.translate || '', input.roman || '')

    ctx.result.lines = lines
    ctx.result.type = Lyric.Parsed.InfoType.VALID
    if (checkIsSyllable(match.line)) {
      ctx.result.timing = Lyric.Common.Timing.WORD
    } else {
      ctx.result.timing = Lyric.Common.Timing.LINE
    }

    ctx.result.meta = processMetas(match.meta)
  }
}
