import { ParserPlugin, ParserContext, PluginStage } from '../../../core'
import { Lyric } from '../../../lyric'
import { Xml } from '../../../utils'

import { parseDocument } from './core'

const CHECK_REGEXP = /xmlns:itunes|iTunesMetadata|itunes:timing=/iu

const AMLL_HINT_REGEXP = /xmlns:amll|amll:meta/iu

export class ItunesParser extends ParserPlugin {
  override get id() {
    return 'TTML-ITUNES-PARSER'
  }

  override get stage() {
    return PluginStage.Process
  }

  override get format() {
    return 'ttml-itunes'
  }

  override check(ctx: ParserContext) {
    const input = ctx.params.content.original
    if (!input) {
      return false
    }

    return CHECK_REGEXP.test(input) && !AMLL_HINT_REGEXP.test(input)
  }

  override exec(ctx: ParserContext) {
    const input = ctx.params.content.original
    if (!input) {
      return
    }

    const root = new Xml.Parser().parse(input)
    // invalid xml parses to null; leave the result untouched.
    if (!root) {
      return
    }

    const { lines, meta, agents, timing } = parseDocument(root)

    ctx.result.type = Lyric.Parsed.InfoType.VALID
    ctx.result.timing = timing
    ctx.result.lines = lines
    ctx.result.meta = meta
    ctx.result.agents = agents
  }
}
