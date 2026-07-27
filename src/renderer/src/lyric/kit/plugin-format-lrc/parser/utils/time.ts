import { parseTime } from '../../../utils'

const LYRIC_TAG_CONTENT_REGEXP = /^[<\[]([^>\]]+)[>\]]$/

/**
 * parse lyric tag time
 *
 * @param tag lyric time tag, e.g. [1:14:514] or <1:14:514>
 */
export const parseTagTime = (tag: string): number | null => {
  const content = tag.trim().match(LYRIC_TAG_CONTENT_REGEXP)
  if (!content) {
    return null
  }

  const time = content[1]?.trim()
  if (!time) {
    return null
  }

  return parseTime(time)
}

const LYRIC_TAG_REGEXP = /(\[[^\]]*\])([\s\S]*?)(?=(?:\[[^\]]*\])|$)/g

export interface ParsedLyricLine {
  raw: string
  tag: string
  content: string
}

/**
 * parse lyric line meta and content
 *
 * support formats:
 *  - e.g. [1:14:514]line content
 *  - e.g. [offset:0][1:14:514]line content
 *
 * @param text raw lyric line
 * @param replaceTag need replace tag
 */
export const parseLyricLine = (text: string): ParsedLyricLine[] => {
  const result: ParsedLyricLine[] = []

  for (const match of text.matchAll(LYRIC_TAG_REGEXP)) {
    const raw = match[0]
    const tag = (match[1] || '').trim()
    const content = (match[2] || '').trim()
    result.push({ raw, tag, content })
  }

  return result
}
