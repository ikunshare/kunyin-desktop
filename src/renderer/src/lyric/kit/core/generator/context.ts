import { Lyric } from '../../lyric'

import type { BaseContext } from '../plugin'

export type GeneratorResult = string | Object | Uint8Array

export interface GeneratorParams {
  content: Lyric.Parsed.Info
}

export class GeneratorContext implements BaseContext {
  private readonly current: {
    params: GeneratorParams
    result: GeneratorResult
  }

  constructor(params: GeneratorParams, init: GeneratorResult) {
    this.current = {
      params,
      result: init
    }
  }

  get params(): GeneratorParams {
    return this.current.params
  }

  get result(): GeneratorResult {
    return this.current.result
  }

  set result(value: GeneratorResult) {
    this.current.result = value
  }
}
