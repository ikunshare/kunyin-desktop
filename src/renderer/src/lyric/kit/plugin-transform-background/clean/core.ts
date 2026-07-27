import { Lyric } from '../../lyric'

const isOpenBracket = (ch: string) => ch === '(' || ch === '（'

const isCloseBracket = (ch: string) => ch === ')' || ch === '）'

export const removeBrackets = (
  line: Lyric.Parsed.ParsedLineNormal | Lyric.Parsed.ParsedLineBackground,
  removeStart: boolean = true,
  removeEnd: boolean = true
): void => {
  const words = line.words

  if (removeStart) {
    for (let i = 0; i < words.length; i++) {
      const word = words[i]
      if (!Lyric.Common.isWordNormal(word)) {
        continue
      }

      const value = word.body.value
      if (isOpenBracket(value.content.charAt(0))) {
        value.content = value.content.substring(1)
        if (!value.content) words.splice(i, 1)
      }
      break
    }
  }

  if (removeEnd) {
    for (let i = words.length - 1; i >= 0; i--) {
      const word = words[i]
      if (!Lyric.Common.isWordNormal(word)) {
        continue
      }

      const value = word.body.value
      const lastCharIdx = value.content.length - 1
      if (isCloseBracket(value.content.charAt(lastCharIdx))) {
        value.content = value.content.slice(0, -1)
        if (!value.content) words.splice(i, 1)
      }
      break
    }
  }

  const stripBrackets = (items: { content: string }[]) => {
    for (const item of items) {
      if (!item.content.trim()) continue

      if (removeStart && isOpenBracket(item.content.charAt(0))) {
        item.content = item.content.substring(1)
      }

      if (removeEnd && item.content) {
        const lastCharIdx = item.content.length - 1
        if (isCloseBracket(item.content.charAt(lastCharIdx))) {
          item.content = item.content.slice(0, -1)
        }
      }
    }
  }

  const annotation = line.annotation
  if (annotation) {
    stripBrackets(annotation.translations)
    stripBrackets(annotation.romans)
  }
}
