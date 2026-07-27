import type { MatchItem } from './utils'

import { Lyric } from '../../lyric'
import { parseTime } from '../../utils'

const applyMeta = (meta: Lyric.Common.Meta, key: string, rawKey: string, content: string) => {
  switch (key) {
    case 'offset':
      meta.offset = Number(content) || 0
      return
    case 'length':
    case 'duration':
      meta.duration = parseTime(content) || 0
      return
    case 'ti':
    case 'title':
      meta.titles.push(Lyric.Common.makeMetaText({ content }))
      return
    case 'ar':
    case 'artist':
      meta.artists.push(Lyric.Common.makeMetaText({ content }))
      return
    case 'al':
    case 'album':
      meta.albums.push(Lyric.Common.makeMetaText({ content }))
      return
    case 'by':
      meta.authors.push(Lyric.Common.makeMetaText({ content }))
      return
    case 'isrc':
      meta.isrcs.push(content)
      return
  }
  meta.unknowns.push(Lyric.Common.makeUnknown({ key: rawKey, value: content }))
}

const LYRIC_META_REGEXP = /^\s*\[\s*([A-Za-z0-9_-]+)\s*:\s*([^\]]*)\s*\]\s*$/

export const processMetas = (metas: MatchItem[]): Lyric.Common.Meta => {
  const result = Lyric.Common.makeMeta()

  for (const meta of metas) {
    if (!meta.tag) {
      continue
    }

    const matched = meta.tag.match(LYRIC_META_REGEXP)
    if (!matched) {
      continue
    }

    const rawKey = (matched[1] || '').trim()
    const key = rawKey.toLowerCase()
    const value = (matched[2] || '').trim()
    if (!key || !value) {
      continue
    }

    applyMeta(result, key, rawKey, value)
  }

  return result
}
