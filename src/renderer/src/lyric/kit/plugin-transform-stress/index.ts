import type { DeepPartial } from '../utils'
import type { MarkConfig } from './config'

import { DEFAULT_CONFIG } from './config'
import { ConfigManager } from '../utils'

import { ParserPlugin, ParserContext, PluginStage } from '../core'
import { Lyric } from '../lyric'

export class Mark extends ParserPlugin {
  override config = new ConfigManager<MarkConfig, DeepPartial<MarkConfig>>(DEFAULT_CONFIG)

  override get id() {
    return 'TRANSFORM-STRESS-MARK'
  }

  override get stage() {
    return PluginStage.Transform
  }

  override check(ctx: ParserContext) {
    return true
  }

  override exec(ctx: ParserContext) {
    const lines = ctx.result.lines
    const length = lines.length

    if (!length) {
      return
    }

    const handleMark = (
      line: Lyric.Parsed.ParsedLineNormal | Lyric.Parsed.ParsedLineBackground
    ) => {
      for (const word of line.words) {
        if (!Lyric.Common.isWordNormal(word)) {
          continue
        }
        const value = word.body.value
        if (
          value.time &&
          Lyric.Common.getTimeDuration(value.time) > this.config.current.checkTime
        ) {
          value.stress = true
        }
      }
    }

    for (const line of lines) {
      if (!Lyric.Parsed.isParsedLineNormal(line)) {
        continue
      }

      const body = line.body.value
      handleMark(body)
      for (const background of body.backgrounds) {
        handleMark(background)
      }
    }
  }
}

export type { MarkConfig }
