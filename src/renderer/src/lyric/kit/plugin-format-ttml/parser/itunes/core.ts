import type { ElementGroups } from '../../utils'
import type { ParseSpanOptions } from './line'

import { Lyric } from '../../../lyric'
import { Xml } from '../../../utils'

import { hasWordTiming, findElementsByLocalName, collectElementsByLocalName } from '../../utils'
import { parseLines } from './line'
import { parseAgents, applyItunesMetas } from './meta'
import { attachHeadAnnotations } from './attach'

// head element local names collected in one pass and reused by every consumer.
const HEAD_BLOCKS = ['songwriter', 'agent', 'translation', 'transliteration', 'meta']

export interface TtmlDocument {
  /**
   * Parsed lines, with head iTunesMetadata annotations already attached.
   */
  lines: Lyric.Parsed.ParsedLine[]
  /**
   * Structured meta read from the iTunesMetadata head.
   */
  meta: Lyric.Common.Meta
  /**
   * Performing agents declared in the head.
   */
  agents: Lyric.Common.AgentItem[]
  /**
   * Whether the lines carry per-word timing.
   */
  timing: Lyric.Common.Timing
  /**
   * Head elements grouped by local name, for dialects that read further from them.
   */
  groups: ElementGroups
}

export const parseDocument = (root: Xml.XmlElement, options?: ParseSpanOptions): TtmlDocument => {
  const body = findElementsByLocalName(root, 'body', true)[0]
  const metadata = findElementsByLocalName(root, 'metadata', true)[0]

  const { lines, lineMap, backgroundMap } = parseLines(body, options)

  const groups: ElementGroups = metadata
    ? collectElementsByLocalName(metadata, HEAD_BLOCKS)
    : new Map()
  attachHeadAnnotations(groups, lineMap, backgroundMap)

  const meta = Lyric.Common.makeMeta()
  applyItunesMetas(meta, groups.get('songwriter') ?? [])

  return {
    lines,
    meta,
    agents: parseAgents(groups.get('agent') ?? []),
    timing: lines.some(hasWordTiming) ? Lyric.Common.Timing.WORD : Lyric.Common.Timing.LINE,
    groups
  }
}
