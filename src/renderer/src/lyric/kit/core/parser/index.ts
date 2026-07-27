import type { DeepPartial } from '../../utils'
import type { ParserOptions } from './options'
import type { ParserParams, ParserContent, ParserResult } from './context'

import { DEFAULT_OPTIONS } from './options'

import { Lyric } from '../../lyric'
import { ConfigManager } from '../../utils'
import { BasePlugin, PluginLoader, PluginStage } from '../plugin'
import { ParserContext } from './context'

export abstract class ParserPlugin extends BasePlugin<ParserContext> {}

export class Parser {
  readonly options: ConfigManager<ParserOptions, DeepPartial<ParserOptions>> = new ConfigManager(
    DEFAULT_OPTIONS
  )

  readonly plugin: PluginLoader<ParserPlugin> = new PluginLoader()

  constructor(options: ParserOptions = {}) {
    this.options.update(options)
  }

  infer(params: ParserParams) {
    const init = Lyric.Parsed.makeParsedInfo({
      type: Lyric.Parsed.InfoType.INVALID,
      timing: Lyric.Common.Timing.NONE
    })
    const context = new ParserContext(params, init)

    const plugins = this.plugin.filterByStage(PluginStage.Process, true) as ParserPlugin[]

    for (const plugin of plugins) {
      try {
        const result = plugin.check.call(plugin, context)
        if (result === true) {
          return plugin.format
        }
      } catch {
        continue
      }
    }

    return null
  }

  parse(format: string, params: ParserParams): ParserResult {
    const processors = this.plugin.filterByStage(PluginStage.Process)
    const current = processors.find((item) => item.format === format)

    if (!current) {
      throw new Error('format not found')
    }

    const init = Lyric.Parsed.makeParsedInfo({
      type: Lyric.Parsed.InfoType.INVALID,
      timing: Lyric.Common.Timing.NONE
    })
    const context = new ParserContext(params, init)

    const plugins: ParserPlugin[] = []

    // before
    plugins.push(...this.plugin.filterByStage(PluginStage.Pre, true))
    // process
    plugins.push(current)
    // transform
    plugins.push(...this.plugin.filterByStage(PluginStage.Transform, true))
    // after all
    plugins.push(...this.plugin.filterByStage(PluginStage.Post, true))

    while (plugins.length > 0) {
      const plugin = plugins.shift()

      if (!plugin) {
        continue
      }

      try {
        const result = plugin.check.call(plugin, context)
        if (!result) {
          continue
        }
      } catch (e: any) {
        console.warn(`plugin check failed id=${plugin.id} err=${e?.message}`)
        continue
      }

      try {
        plugin.exec.call(plugin, context)
      } catch (e: any) {
        console.warn(`plugin call failed id=${plugin.id} err=${e?.message}`)
        break
      }
    }

    context.cleanWord()
    context.syncLineTimeWithWord()
    context.sort()
    context.syncLineTimeWithBackground()

    return context.result
  }
}

export { ParserContext }

export type { ParserParams, ParserContent, ParserResult, ParserOptions }
