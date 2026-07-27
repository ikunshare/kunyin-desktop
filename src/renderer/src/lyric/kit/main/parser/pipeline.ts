import type { ParserParams } from '../../core'

import { Lyric } from '../../lyric'
import { ParserContext, ParserPlugin } from '../../core'

import { Format, Transform } from '../plugin'

export interface ParserPipelineInput {
  format?: string
  content: ParserParams['content']
  musicInfo?: ParserParams['musicInfo']
}

export interface ParserPipelineResult {
  format: string
  result: Lyric.Parsed.Info
}

const BuiltInFormats = [
  new Format.Lrc.Parser(),
  new Format.Ttml.AmllParser(),
  new Format.Ttml.ItunesParser()
]

class Agent {
  private _extract = new Transform.Agent.Extract()

  constructor(private client: ParserPipeline) {}

  extract(options?: Transform.Agent.ExtractConfig) {
    return this.client.run(this._extract, options)
  }
}

class Background {
  private _extract = new Transform.Background.Extract()
  private _clean = new Transform.Background.Clean()

  constructor(private client: ParserPipeline) {}

  extract(options?: Transform.Background.ExtractConfig) {
    return this.client.run(this._extract, options)
  }

  clean() {
    return this.client.run(this._clean)
  }
}

class Pure {
  private _extractCreator = new Transform.Pure.ExtractCreator()
  private _clean = new Transform.Pure.Clean()

  constructor(private client: ParserPipeline) {}

  extractCreator(options?: Transform.Pure.ExtractCreatorConfig) {
    return this.client.run(this._extractCreator, options)
  }

  clean(options?: Transform.Pure.CleanConfig) {
    return this.client.run(this._clean, options)
  }
}

class Interlude {
  private _insert = new Transform.Interlude.Insert()

  constructor(private client: ParserPipeline) {}

  insert(options?: Transform.Interlude.InsertConfig) {
    return this.client.run(this._insert, options)
  }
}

class Space {
  private _insert = new Transform.Space.Insert()

  constructor(private client: ParserPipeline) {}

  insert(options?: Transform.Space.SpaceConfig) {
    return this.client.run(this._insert, options)
  }
}

class Stress {
  private _mark = new Transform.Stress.Mark()

  constructor(private client: ParserPipeline) {}

  mark(options?: Transform.Stress.MarkConfig) {
    return this.client.run(this._mark, options)
  }
}

class Language {
  private _infer = new Transform.Language.Infer()
  private _calculatePercent = new Transform.Language.CalculatePercent()

  constructor(private client: ParserPipeline) {}

  infer(options?: Transform.Language.InferConfig) {
    return this.client.run(this._infer, options)
  }

  calculatePercent(options?: Transform.Language.CalculateConfig) {
    return this.client.run(this._calculatePercent, options)
  }
}

export class ParserPipeline {
  private context: ParserContext
  private format: string
  private input: ParserPipelineInput
  private done: boolean

  readonly agent: Agent
  readonly background: Background
  readonly pure: Pure
  readonly interlude: Interlude
  readonly space: Space
  readonly stress: Stress
  readonly language: Language

  constructor(input: ParserPipelineInput) {
    this.done = false
    this.input = input
    this.format = this.input.format || ''

    const init = Lyric.Parsed.makeParsedInfo({
      type: Lyric.Parsed.InfoType.INVALID,
      timing: Lyric.Common.Timing.NONE
    })
    this.context = new ParserContext(
      { content: this.input.content, musicInfo: this.input.musicInfo },
      init
    )

    this.agent = new Agent(this)
    this.background = new Background(this)
    this.pure = new Pure(this)
    this.interlude = new Interlude(this)
    this.space = new Space(this)
    this.stress = new Stress(this)
    this.language = new Language(this)
  }

  private applyConfig(plugin: ParserPlugin, options?: any) {
    if (!plugin.config) {
      return
    }

    // reset to defaults and apply this run's options in a single update.
    plugin.config.apply(options)
  }

  private exec(plugin: ParserPlugin) {
    this.done = false

    try {
      const result = plugin.check(this.context)
      if (!result) {
        return
      }
    } catch (e: any) {
      console.warn(`plugin check failed id=${plugin.id} err=${e?.message}`)
      return
    }

    try {
      plugin.exec(this.context)
    } catch (e: any) {
      console.warn(`plugin call failed id=${plugin.id} err=${e?.message}`)
    }
  }

  /**
   * Apply optional config to a plugin and execute it against the current context.
   * Intended for use by the pipeline plugin scopes.
   */
  run(plugin: ParserPlugin, options?: any): this {
    this.applyConfig(plugin, options)
    this.exec(plugin)
    return this
  }

  infer(): this {
    if (this.format) {
      return this
    }
    for (const plugin of BuiltInFormats) {
      try {
        const result = plugin.check(this.context)
        if (result) {
          this.format = plugin.format
          break
        }
      } catch {
        continue
      }
    }
    return this
  }

  parse(): this {
    if (!this.format) {
      throw new Error('no format detected. call .infer() before .parse()')
    }

    const parser = BuiltInFormats.find((item) => item.format === this.format)
    if (!parser) {
      throw new Error(`parser plugin not found: "${this.format}"`)
    }

    this.done = false

    try {
      parser.exec(this.context)
    } catch (e: any) {
      console.warn(`plugin call failed id=${parser.id} err=${e?.message}`)
    }

    this.context.finalizeAnnotation()

    return this
  }

  final(): ParserPipelineResult {
    if (!this.done) {
      this.context.cleanWord()
      this.context.finalizeAnnotation()
      this.context.syncLineTimeWithWord()
      this.context.sort()
      this.context.syncLineTimeWithBackground()
      this.done = true
    }

    return {
      format: this.format,
      result: this.context.result
    }
  }
}

export const createParserPipeline = (input: ParserPipelineInput) => {
  return new ParserPipeline(input)
}
