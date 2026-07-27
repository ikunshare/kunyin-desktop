import { Lyric } from '../../lyric'

const isOpenBracket = (ch: string) => ch === '(' || ch === '（'

const isCloseBracket = (ch: string) => ch === ')' || ch === '）'

/**
 * Copy a word verbatim, preserving its language.
 */
const copyWord = (word: Lyric.Common.Word): Lyric.Common.Word | undefined => {
  if (Lyric.Common.isWordSpace(word)) {
    return Lyric.Common.makeWordSpace({ count: word.body.value.count })
  }
  if (Lyric.Common.isWordNormal(word)) {
    const value = word.body.value
    return Lyric.Common.makeWordNormal({
      content: value.content,
      time: value.time
        ? Lyric.Common.makeTime({ start: value.time.start, end: value.time.end })
        : undefined,
      language: value.language,
      annotation: value.annotation,
      stress: value.stress
    })
  }
  return undefined
}

/**
 * Copy a normal word but replace its text content.
 */
const copyNormalWord = (word: Lyric.Common.WordNormal, content: string): Lyric.Common.Word => {
  return Lyric.Common.makeWordNormal({
    content,
    time: word.time
      ? Lyric.Common.makeTime({ start: word.time.start, end: word.time.end })
      : undefined,
    language: word.language,
    annotation: word.annotation,
    stress: word.stress
  })
}

/**
 * Turn a line into a background line, carrying over its time, agents, languages, words and annotation.
 */
export const toBackground = (
  line: Lyric.Parsed.ParsedLineNormal
): Lyric.Parsed.ParsedLineBackground => {
  return Lyric.Parsed.makeParsedLineBackground({
    time: line.time,
    agents: line.agents.slice(),
    languages: line.languages.slice(),
    words: line.words.slice(),
    annotation: line.annotation
  })
}

const findFirstNormalWord = (
  line: Lyric.Parsed.ParsedLineNormal
): Lyric.Common.WordNormal | null => {
  const words = line.words
  for (let i = 0, len = words.length; i < len; i++) {
    const word = words[i]
    if (Lyric.Common.isWordNormal(word)) {
      return word.body.value
    }
  }
  return null
}

const findLastNormalWord = (
  line: Lyric.Parsed.ParsedLineNormal
): Lyric.Common.WordNormal | null => {
  const words = line.words
  for (let i = words.length - 1; i >= 0; i--) {
    const word = words[i]
    if (Lyric.Common.isWordNormal(word)) {
      return word.body.value
    }
  }
  return null
}

export const addBackground = (
  line: Lyric.Parsed.ParsedLineNormal,
  background: Lyric.Parsed.ParsedLineBackground
) => {
  line.backgrounds.push(background)
}

export const hasStartOpenBracket = (line: Lyric.Parsed.ParsedLineNormal) => {
  const first = findFirstNormalWord(line)
  if (!first) {
    return false
  }
  return isOpenBracket(first.content.charAt(0))
}

export const hasEndCloseBracket = (line: Lyric.Parsed.ParsedLineNormal) => {
  const last = findLastNormalWord(line)
  if (!last) {
    return false
  }
  return isCloseBracket(last.content.charAt(last.content.length - 1))
}

export const isFullLine = (line: Lyric.Parsed.ParsedLineNormal) => {
  const start = findFirstNormalWord(line)
  const end = findLastNormalWord(line)
  if (!start || !end || start === end) {
    return false
  }

  const startChar = start.content.charAt(0)
  const endChar = end.content.charAt(end.content.length - 1)

  return isOpenBracket(startChar) && isCloseBracket(endChar)
}

const extractInLineExtended = (content: string): [string, string[]] => {
  let main = ''
  let current = ''

  let inBracket = false
  let lastChar = ''

  const result: string[] = []

  for (let i = 0; i < content.length; i++) {
    const char = content[i]

    if (isOpenBracket(char)) {
      if (inBracket) {
        current += char
      } else {
        inBracket = true
        lastChar = char
      }
    } else if (isCloseBracket(char)) {
      if (inBracket) {
        result.push(current)
        current = ''
        inBracket = false
      } else {
        main += char
      }
    } else {
      if (inBracket) {
        current += char
      } else {
        main += char
      }
    }
  }

  // no close (
  if (inBracket) {
    main += lastChar + current
  }

  return [main, result]
}

export const extractInLine = (line: Lyric.Parsed.ParsedLineNormal) => {
  let hasOpen = false
  let hasClose = false

  for (const word of line.words) {
    if (Lyric.Common.isWordNormal(word)) {
      const text = word.body.value.content
      for (let i = 0; i < text.length; i++) {
        if (isOpenBracket(text[i])) hasOpen = true
        if (isCloseBracket(text[i])) hasClose = true
      }
    }
  }

  if (!hasOpen && !hasClose) {
    return
  }

  const words = line.words
  const mainWords: Lyric.Common.Word[] = []
  const backgroundGroups: Lyric.Common.Word[][] = []

  let currentBackground: Lyric.Common.Word[] = []
  let inBracket = false
  let lastOpenChar = ''
  let lastOpenWord: Lyric.Common.WordNormal | null = null

  for (const word of words) {
    if (!Lyric.Common.isWordNormal(word)) {
      const copy = copyWord(word)
      if (copy) {
        if (inBracket) {
          currentBackground.push(copy)
        } else {
          mainWords.push(copy)
        }
      }
      continue
    }

    const value = word.body.value
    const text = value.content
    let buffer = ''

    for (let j = 0; j < text.length; j++) {
      const char = text[j]

      if (isOpenBracket(char)) {
        if (inBracket) {
          buffer += char
        } else {
          if (buffer) {
            mainWords.push(copyNormalWord(value, buffer))
            buffer = ''
          }
          inBracket = true
          lastOpenChar = char
          lastOpenWord = value
        }
      } else if (isCloseBracket(char)) {
        if (inBracket) {
          if (buffer) {
            currentBackground.push(copyNormalWord(value, buffer))
            buffer = ''
          }
          if (currentBackground.length > 0) {
            backgroundGroups.push(currentBackground)
            currentBackground = []
          }
          inBracket = false
        } else {
          buffer += char
        }
      } else {
        buffer += char
      }
    }

    if (buffer) {
      const target = inBracket ? currentBackground : mainWords
      target.push(copyNormalWord(value, buffer))
    }
  }

  // no close (
  if (inBracket) {
    if (lastOpenWord) {
      mainWords.push(copyNormalWord(lastOpenWord, lastOpenChar))
    }
    mainWords.push(...currentBackground)
    currentBackground = []
  }

  if (backgroundGroups.length === 0) {
    return
  }

  line.words = mainWords

  for (const item of backgroundGroups) {
    const normals = item.filter(Lyric.Common.isWordNormal).map((w) => w.body.value)
    const result = Lyric.Parsed.makeParsedLineBackground({
      time:
        normals.length > 0
          ? Lyric.Common.makeTime({
              start: normals[0].time?.start ?? 0,
              end: normals[normals.length - 1].time?.end ?? 0
            })
          : undefined,
      words: item
    })

    addBackground(line, result)
  }
}

export const assignBackgroundAnnotation = (line: Lyric.Parsed.ParsedLineNormal) => {
  const backgroundLines = line.backgrounds
  if (!backgroundLines.length) {
    return
  }

  const annotation = line.annotation
  if (!annotation) {
    return
  }

  const split = (
    items: { content: string; language?: string }[],
    push: (
      background: Lyric.Parsed.ParsedLineBackground,
      content: string,
      language?: string
    ) => void
  ) => {
    for (const item of items) {
      if (!item.content.trim()) {
        continue
      }

      const [main, backgrounds] = extractInLineExtended(item.content)
      item.content = main

      for (let i = 0; i < backgrounds.length; i++) {
        if (i >= backgroundLines.length) {
          continue
        }
        push(backgroundLines[i], backgrounds[i], item.language)
      }
    }
  }

  split(annotation.translations, (background, text, language) => {
    const target =
      background.annotation ?? (background.annotation = Lyric.Common.makeLineAnnotation())
    target.translations.push(
      Lyric.Common.makeLineAnnotationTranslation({ content: text, language })
    )
  })
  split(annotation.romans, (background, text, language) => {
    const target =
      background.annotation ?? (background.annotation = Lyric.Common.makeLineAnnotation())
    target.romans.push(Lyric.Common.makeLineAnnotationRoman({ content: text, language }))
  })
}

export const extractCrossLine = (lines: Lyric.Parsed.ParsedLine[]): Lyric.Parsed.ParsedLine[] => {
  const result: Lyric.Parsed.ParsedLine[] = []

  for (let i = 0; i < lines.length; i++) {
    const current = lines[i]

    const next = lines[i + 1]
    if (!next) {
      result.push(current)
      continue
    }

    const prev = result[result.length - 1]
    if (!prev) {
      result.push(current)
      continue
    }

    if (Lyric.Parsed.isParsedLineNormal(current) && Lyric.Parsed.isParsedLineNormal(next)) {
      // Skip if current line has complete brackets
      if (hasStartOpenBracket(current.body.value) && hasEndCloseBracket(current.body.value)) {
        result.push(current)
        continue
      }

      if (hasStartOpenBracket(current.body.value) && hasEndCloseBracket(next.body.value)) {
        if (Lyric.Parsed.isParsedLineNormal(prev)) {
          addBackground(prev.body.value, toBackground(current.body.value))
          addBackground(prev.body.value, toBackground(next.body.value))

          // skip next
          i++
          continue
        }
      }
    }

    result.push(current)
  }

  return result
}
