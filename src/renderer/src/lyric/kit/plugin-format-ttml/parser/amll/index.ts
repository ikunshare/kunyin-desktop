import { ParserPlugin, ParserContext, PluginStage } from '../../../core'
import { Lyric } from '../../../lyric'
import { Xml } from '../../../utils'

import { parseDocument } from '../itunes/core'
import { getAttributeByName } from '../../utils'
import { interceptRubySpan } from './ruby'

const CHECK_REGEXP = /xmlns:amll=["'][^"']+["']|amll:meta/iu

const applyAmllMeta = (meta: Lyric.Common.Meta, element: Xml.XmlElement) => {
  const key = getAttributeByName(element, 'key', true)
  const value = getAttributeByName(element, 'value', true)

  if (!key || !value) {
    return
  }

  const text = value.trim()
  switch (key) {
    case 'musicName':
      meta.titles.push(Lyric.Common.makeMetaText({ content: text }))
      return
    case 'artists':
      meta.artists.push(Lyric.Common.makeMetaText({ content: text }))
      return
    case 'album':
      meta.albums.push(Lyric.Common.makeMetaText({ content: text }))
      return
    case 'isrc':
      meta.isrcs.push(text)
      return
    case 'ttmlAuthorGithubLogin':
      meta.authors.push(Lyric.Common.makeMetaText({ content: text }))
      return
    default:
      // keep every other amll:meta (platform ids, github id, ...) under its original key for round-trip
      meta.unknowns.push(Lyric.Common.makeUnknown({ key, value: text }))
  }
}

const applyAmllMetas = (meta: Lyric.Common.Meta, metas: Xml.XmlElement[]) => {
  for (const element of metas) {
    applyAmllMeta(meta, element)
  }
}

export class AmllParser extends ParserPlugin {
  override get id() {
    return 'TTML-AMLL-PARSER'
  }

  override get stage() {
    return PluginStage.Process
  }

  override get format() {
    return 'ttml-amll'
  }

  override check(ctx: ParserContext) {
    const input = ctx.params.content.original
    if (!input) {
      return false
    }

    return CHECK_REGEXP.test(input)
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

    const { lines, meta, agents, timing, groups } = parseDocument(root, {
      onSpan: interceptRubySpan
    })

    // amll is itunes plus its own amll:meta layered on top.
    applyAmllMetas(meta, groups.get('meta') ?? [])

    ctx.result.type = Lyric.Parsed.InfoType.VALID
    ctx.result.timing = timing
    ctx.result.lines = lines
    ctx.result.meta = meta
    ctx.result.agents = agents
  }
}
