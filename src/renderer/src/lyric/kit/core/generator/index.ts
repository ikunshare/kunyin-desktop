import type { DeepPartial } from '../../utils'
import type { GeneratorOptions } from './options'
import type { GeneratorParams, GeneratorResult } from './context'

import { DEFAULT_OPTIONS } from './options'

import { Lyric } from '../../lyric'
import { ConfigManager } from '../../utils'
import { BasePlugin, PluginLoader, PluginStage } from '../plugin'
import { GeneratorContext } from './context'

export abstract class GeneratorPlugin extends BasePlugin<GeneratorContext> {}

export class Generator {
  readonly options: ConfigManager<GeneratorOptions, DeepPartial<GeneratorOptions>> =
    new ConfigManager(DEFAULT_OPTIONS)

  readonly plugin: PluginLoader<GeneratorPlugin> = new PluginLoader()

  constructor(options: GeneratorOptions = {}) {
    this.options.update(options)
  }

  generate(format: string, params: GeneratorParams): GeneratorResult {
    const processors = this.plugin.filterByStage(PluginStage.Process)
    const current = processors.find((item) => item.format === format)

    if (!current) {
      throw new Error('format not found')
    }

    const init = Lyric.Parsed.makeParsedInfo({
      type: Lyric.Parsed.InfoType.INVALID,
      timing: Lyric.Common.Timing.NONE
    })
    const context = new GeneratorContext(params, init)

    const plugins: GeneratorPlugin[] = []

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

    return context.result
  }
}

export { GeneratorContext }

export type { GeneratorParams, GeneratorResult, GeneratorOptions }
