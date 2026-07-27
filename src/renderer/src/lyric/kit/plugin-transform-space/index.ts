import type { DeepPartial } from '../utils'
import type { SpaceConfig } from './config'

import { DEFAULT_CONFIG } from './config'
import { ConfigManager } from '../utils'

import { ParserPlugin, ParserContext, PluginStage } from '../core'
import { Lyric } from '../lyric'

import { insertSpaceToExtended, insertSpaceToLine, processTypes } from './core'

export class Insert extends ParserPlugin {
  override config = new ConfigManager<SpaceConfig, DeepPartial<SpaceConfig>>(DEFAULT_CONFIG)

  override get id() {
    return 'TRANSFORM-SPACE-INSERT'
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

    const enableOriginal = this.config.current.original
    const enableExtended = this.config.current.extended
    if (!enableOriginal && !enableExtended) {
      return
    }

    const target = processTypes(this.config.current.types)

    const handleLine = (
      line: Lyric.Parsed.ParsedLineNormal | Lyric.Parsed.ParsedLineBackground
    ) => {
      if (enableOriginal) {
        insertSpaceToLine(line, target)
      }
      if (enableExtended) {
        insertSpaceToExtended(line, target)
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
  }
}

export { INSERT_TEXT_SPACE_TYPES } from './constants'
export type { InsertTextSpaceTypes } from './constants'

export type { SpaceConfig }
