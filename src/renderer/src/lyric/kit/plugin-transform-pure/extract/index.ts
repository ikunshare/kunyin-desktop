import type { DeepPartial } from '../../utils'
import type { ExtractCreatorConfig } from './config'

import { DEFAULT_CREATOR_CONFIG } from './config'
import { DEFAULT_CREATOR_RULES } from './constants'

import { ConfigManager } from '../../utils'
import { Matcher } from '../utils/match'

import { ParserPlugin, ParserContext, PluginStage } from '../../core'
import { Lyric } from '../../lyric'
import { extractCreator, splitNameWithRule } from './utils'

export class ExtractCreator extends ParserPlugin {
  private matcher: Matcher

  override config = new ConfigManager<ExtractCreatorConfig, DeepPartial<ExtractCreatorConfig>>(
    DEFAULT_CREATOR_CONFIG
  )

  override get priority() {
    return 40
  }

  override get id() {
    return 'TRANSFORM-PURE-EXTRACT'
  }

  override get stage() {
    return PluginStage.Transform
  }

  constructor() {
    super()
    this.matcher = Matcher.create(this.config.current.match, DEFAULT_CREATOR_RULES)
    this.config.event.add('update', (keys, opt) => {
      this.matcher = this.matcher.update(opt.match)
    })
  }

  override check(ctx: ParserContext) {
    return true
  }

  override exec(ctx: ParserContext) {
    const lines = ctx.result.lines
    if (!lines.length) {
      return
    }

    const meta = ctx.result.meta ?? (ctx.result.meta = Lyric.Common.makeMeta())
    const newLines: Lyric.Parsed.ParsedLine[] = []

    for (const line of lines) {
      if (!Lyric.Parsed.isParsedLineNormal(line)) {
        newLines.push(line)
        continue
      }

      const target = extractCreator(Lyric.Parsed.getParsedLineText(line))
      if (!target) {
        newLines.push(line)
        continue
      }

      const [role, name] = target
      // 保留英文职务中的空格，才能命中 `Mixing Engineer` 等短语；
      // 无空格写法仍由规则中的兼容分支处理。
      const result = this.matcher.match(role)

      if (!result) {
        newLines.push(line)
        continue
      }

      if (name) {
        const names = splitNameWithRule(name, this.config.current.split)
        if (names.length > 0) {
          meta.credits.push(
            Lyric.Common.makeMetaCredit({
              role,
              names: names.map((item) => Lyric.Common.makeMetaText({ content: item }))
            })
          )
        }
      }

      if (!this.config.current.replace) {
        newLines.push(line)
      }
    }

    ctx.result.lines = newLines
  }
}

export type { ExtractCreatorConfig }
