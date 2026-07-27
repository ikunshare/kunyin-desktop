import { Lyric } from '../../../lyric'
import { Xml } from '../../../utils'

import {
  getChildElementsByLocalName,
  getAttributeByName,
  getTextContent,
  parseSpanTime
} from '../../utils'

const parseRubyItems = (container: Xml.XmlElement): Lyric.Common.WordAnnotationContent[] => {
  const tokens: Lyric.Common.WordAnnotationContent[] = []
  for (const span of getChildElementsByLocalName(container, 'span')) {
    if (getAttributeByName(span, 'ruby', true) !== 'text') {
      continue
    }
    const content = getTextContent(span).trim()
    if (!content) {
      continue
    }
    const time = parseSpanTime(span)
    if (!time) {
      continue
    }
    tokens.push(
      Lyric.Common.makeWordAnnotationContent({
        content,
        time: Lyric.Common.makeTime({ start: time.start, end: time.end })
      })
    )
  }
  return tokens
}

export const interceptRubySpan = (span: Xml.XmlElement, words: Lyric.Common.Word[]): boolean => {
  if (getAttributeByName(span, 'ruby', true) !== 'container') {
    return false
  }

  let base = ''
  let items: Lyric.Common.WordAnnotationContent[] = []
  for (const child of getChildElementsByLocalName(span, 'span')) {
    const kind = getAttributeByName(child, 'ruby', true)
    if (kind === 'base') {
      base = getTextContent(child).trim()
    } else if (kind === 'textContainer') {
      items = parseRubyItems(child)
    }
  }

  // a span already identified as a ruby container is fully owned here, even when malformed.
  if (!base || !items.length) {
    return true
  }

  const start = items[0].time!.start
  const end = items[items.length - 1].time!.end

  const phraseStart = getAttributeByName(span, 'rubyPhraseStart', true) === 'true'
  const ruby = Lyric.Common.makeWordAnnotationRuby({
    words: items,
    time: Lyric.Common.makeTime({ start, end }),
    phraseStart
  })

  const word = Lyric.Common.makeWordNormal({
    content: base,
    time: Lyric.Common.makeTime({ start, end }),
    annotation: Lyric.Common.makeWordAnnotation({ rubies: [ruby] })
  })

  words.push(word)
  return true
}
