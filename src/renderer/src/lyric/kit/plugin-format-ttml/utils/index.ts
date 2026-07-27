import { Lyric } from '../../lyric'
import { removeTextSpaceToOne } from '../../utils'

export * from './xml'

export const parseTextToWords = (text: string): Lyric.Common.Word[] => {
  const normalized = removeTextSpaceToOne(text).trim()
  const words = normalized.split(/(\s+)/g)

  const result: Lyric.Common.Word[] = []

  for (const current of words) {
    if (current.trim() === '') {
      result.push(Lyric.Common.makeWordSpace({ count: 1 }))
      continue
    }

    result.push(Lyric.Common.makeWordNormal({ content: current.trim() }))
  }

  return result
}

export const hasWordTiming = (line?: Lyric.Parsed.ParsedLine) => {
  if (!line || !Lyric.Parsed.isParsedLineNormal(line)) {
    return false
  }
  for (const word of line.body.value.words) {
    if (Lyric.Common.isWordNormal(word) && (word.body.value.time?.start ?? 0) > 0) {
      return true
    }
  }
  return false
}

/**
 * Ensure a line has an annotation object and return it.
 */
export const ensureAnnotation = (
  line: Lyric.Parsed.ParsedLineNormal | Lyric.Parsed.ParsedLineBackground
): Lyric.Common.LineAnnotation => {
  return line.annotation ?? (line.annotation = Lyric.Common.makeLineAnnotation())
}
