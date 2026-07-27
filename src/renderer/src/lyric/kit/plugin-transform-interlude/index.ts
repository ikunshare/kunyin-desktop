import type { DeepPartial } from '../utils'
import type { InsertConfig } from './config'

import { DEFAULT_CONFIG } from './config'
import { ConfigManager } from '../utils'

import { ParserPlugin, ParserContext, PluginStage } from '../core'
import { Lyric } from '../lyric'

export class Insert extends ParserPlugin {
  override config = new ConfigManager<InsertConfig, DeepPartial<InsertConfig>>(DEFAULT_CONFIG)

  override get priority() {
    return 500
  }

  override get id() {
    return 'TRANSFORM-INTERLUDE-INSERT'
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

    const { first: firstThreshold, normal: normalThreshold } = this.config.current.checkTime

    const newLines: Lyric.Parsed.ParsedLine[] = []

    const firstStart = Lyric.Parsed.getParsedLineTime(lines[0])?.start ?? 0
    if (firstStart > firstThreshold) {
      const start = 500
      const end = firstStart
      if (end > start) {
        newLines.push(
          Lyric.Parsed.makeParsedLineInterlude({ time: Lyric.Common.makeTime({ start, end }) })
        )
      }
    }

    for (let i = 0; i < length - 1; i++) {
      const current = lines[i]
      const next = lines[i + 1]

      newLines.push(current)

      const currentEnd = Lyric.Parsed.getParsedLineTime(current)?.end ?? 0
      const nextStart = Lyric.Parsed.getParsedLineTime(next)?.start ?? 0
      const start = currentEnd + 100
      const duration = nextStart - start

      if (duration > normalThreshold) {
        newLines.push(
          Lyric.Parsed.makeParsedLineInterlude({
            time: Lyric.Common.makeTime({ start, end: nextStart })
          })
        )
      }
    }

    newLines.push(lines[length - 1])

    ctx.result.lines = newLines
  }
}

export type { InsertConfig }
