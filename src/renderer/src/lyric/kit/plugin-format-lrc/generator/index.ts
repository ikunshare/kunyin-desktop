import { GeneratorContext, GeneratorPlugin, PluginStage } from '../../core'

import { exportLines } from './line'
import { exportMeta } from './meta'

export class Generator extends GeneratorPlugin {
  override get id() {
    return 'LRC-GENERATOR'
  }

  override get stage() {
    return PluginStage.Process
  }

  override get format() {
    return 'lrc'
  }

  override check(ctx: GeneratorContext) {
    return true
  }

  override exec(ctx: GeneratorContext) {
    const { original, syllable, translate, roman } = exportLines(ctx.params.content)

    const meta = exportMeta(ctx.params.content)

    const targetOriginal = [meta.join('\n'), '\n', '\n', original.join('\n')]
    const targetSyllable = [meta.join('\n'), '\n', '\n', syllable.join('\n')]

    ctx.result = {
      original: targetOriginal.join('').trim(),
      syllable: targetSyllable.join('\n').trim(),
      translate: translate.join('\n').trim(),
      roman: roman.join('\n').trim()
    }
  }
}
