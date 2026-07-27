import { checkTextIsValid, removeTextSpaceAll } from '../../../utils'

export interface MatchItem {
  raw: string
  tag: string
  content: string
}

export interface MatchInfo {
  meta: MatchItem[]
  line: MatchItem[]
}

// prettier-ignore
const LINE_REGEXP = /(\[(?:[a-zA-Z]+\s*:\s*[^\]]+|(?:\d+:)?\d+:\d+(?:\.\d+)?)\])([\s\S]*?)(?=(?:\[(?:[a-zA-Z]+\s*:\s*[^\]]+|(?:\d+:)?\d+:\d+(?:\.\d+)?)\])|$)/g

const META_REGEX = /^\[[a-zA-Z]+:[^\]]+\]$/
const LINE_REGEX = /^\[(\d+:)?\d+:\d+(\.\d+)?\].+$/

const checkIsValidMeta = (content: string) => {
  return META_REGEX.test(removeTextSpaceAll(content))
}

const checkIsValidLine = (content: string) => {
  return LINE_REGEX.test(removeTextSpaceAll(content))
}

const matchLine = (content: string) => {
  const result: MatchItem[] = []

  for (const match of content.matchAll(LINE_REGEXP)) {
    const raw = match[0]
    const tag = (match[1] || '').trim()
    const content = (match[2] || '').trim()

    if (!tag) {
      continue
    }

    const item: MatchItem = { raw, tag, content }
    result.push(item)
  }

  return result
}

export const matchLyric = (content?: string) => {
  const result: MatchInfo = { line: [], meta: [] }

  if (!content || !checkTextIsValid(content)) {
    return result
  }

  const parsed: MatchItem[] = []
  for (const line of content.split('\n')) {
    if (!line.trim()) {
      continue
    }
    const item = matchLine(line)
    parsed.push(...item)
  }

  for (const item of parsed) {
    if (checkIsValidMeta(item.raw)) {
      result.meta.push(item)
      continue
    }
    if (checkIsValidLine(item.raw)) {
      result.line.push(item)
      continue
    }
  }

  return result
}
