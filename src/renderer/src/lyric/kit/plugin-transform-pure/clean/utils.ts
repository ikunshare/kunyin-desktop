import { removeTextSpaceToOne } from '../../utils'

const PUNCTUATION_REGEXP = /[\p{P}\p{S}\p{C}]/gu

export const processText = (text: string): string[] => {
  if (!text || !text.trim()) {
    return []
  }

  const processed = removeTextSpaceToOne(text).replace(PUNCTUATION_REGEXP, '').trim().toLowerCase()
  if (!processed) {
    return []
  }

  return processed
    .split(' ')
    .map((item) => item.trim())
    .filter(Boolean)
}
