import { Lyric } from '../../../lyric'
import { removeTextSpaceToOne } from '../../../utils'

export * from './time'
export * from './match'

export const processTextToWords = (text: string): Lyric.Common.Word[] => {
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
