import type { DeepPartial } from '../../utils'
import type { CleanConfig } from './config'

import { DEFAULT_CONFIG } from './config'
import { DEFAULT_RULES } from './constants'

import { ConfigManager } from '../../utils'
import { Matcher } from '../utils/match'

import { ParserPlugin, ParserContext, PluginStage } from '../../core'
import { Lyric } from '../../lyric'

import { processText } from './utils'

export class Clean extends ParserPlugin {
  private matcher: Matcher

  override config = new ConfigManager<CleanConfig, DeepPartial<CleanConfig>>(DEFAULT_CONFIG)

  override get priority() {
    return 50
  }

  override get id() {
    return 'TRANSFORM-PURE-CLEAN'
  }

  override get stage() {
    return PluginStage.Transform
  }

  constructor() {
    super()
    this.matcher = Matcher.create(this.config.current, DEFAULT_RULES)
    this.config.event.add('update', (keys, opt) => {
      this.matcher = this.matcher.update(opt)
    })
  }

  override check(ctx: ParserContext) {
    return true
  }

  override exec(ctx: ParserContext) {
    const lines = ctx.result.lines
    const linesLength = lines.length
    if (!linesLength) {
      return
    }

    const newLines: Lyric.Parsed.ParsedLine[] = []

    const musicInfo = ctx.params.musicInfo

    for (let i = 0; i < linesLength; i++) {
      const line = lines[i]
      if (!Lyric.Parsed.isParsedLineNormal(line)) {
        newLines.push(line)
        continue
      }

      let extra: string[] | undefined
      if (i === 0 && musicInfo && this.config.current.firstLineWithMusicInfo) {
        extra = [...processText(musicInfo.name || '')]
        if (musicInfo.singer) {
          for (const item of musicInfo.singer) {
            extra.push(...processText(item))
          }
        }
      }

      const clean = extra?.length
        ? processText(Lyric.Parsed.getParsedLineText(line)).join('')
        : Lyric.Parsed.getParsedLineText(line)
      const result = this.matcher.match(clean, extra)
      if (!result) {
        newLines.push(line)
      }
    }

    ctx.result.lines = newLines
  }
}

export type { CleanConfig }
