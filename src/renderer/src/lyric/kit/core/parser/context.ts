import { Lyric } from '../../lyric'

import type { BaseContext } from '../plugin'

export type ParserResult = Lyric.Parsed.Info

export interface ParserContent {
  original: string
  translate?: string
  roman?: string
}

export interface ParserParams {
  content: ParserContent | string
  musicInfo?: {
    name?: string
    singer?: string[]
  }
}

type ParserContextParams = Omit<ParserParams, 'content'> & {
  content: ParserContent
}

export class ParserContext implements BaseContext {
  private readonly current: {
    params: ParserContextParams
    result: ParserResult
    runtime: Record<string, any>
  }

  constructor(params: ParserParams, init: ParserResult) {
    this.current = {
      params: {
        ...params,
        content: typeof params.content === 'string' ? { original: params.content } : params.content
      },
      result: init,
      runtime: {}
    }
  }

  get params(): ParserContextParams {
    return this.current.params
  }

  get result(): ParserResult {
    return this.current.result
  }

  get runtime(): Record<string, any> {
    return this.current.runtime
  }

  /**
   * Sort all lines and their background lines by start time in ascending order.
   */
  sort() {
    Lyric.Parsed.sortParsedLinesByTime(this.result)
  }

  /**
   * Sync each line's start/end time to match the time range of its first and last normal word.
   */
  syncLineTimeWithWord() {
    for (const line of this.result.lines) {
      if (!Lyric.Parsed.isParsedLineNormal(line)) {
        continue
      }
      const body = line.body.value
      this.syncTimeWithWord(body, body.words)
      for (const background of body.backgrounds) {
        this.syncTimeWithWord(background, background.words)
      }
    }
  }

  /**
   * Sync a time holder's range to the first and last normal word of the given words.
   */
  private syncTimeWithWord(holder: { time?: Lyric.Common.Time }, words: Lyric.Common.Word[]) {
    let first: Lyric.Common.WordNormal | null = null
    let last: Lyric.Common.WordNormal | null = null
    for (let i = 0, len = words.length; i < len; i++) {
      const word = words[i]
      if (!Lyric.Common.isWordNormal(word)) {
        continue
      }
      if (!first) {
        first = word.body.value
      }
      last = word.body.value
    }

    if (!first || !last) {
      return
    }

    const startTime = first.time?.start || 0
    const endTime = last.time?.end || 0
    if (startTime <= 0 || endTime <= 0) {
      return
    }

    if (holder.time) {
      holder.time.start = startTime
      holder.time.end = endTime
    } else {
      holder.time = Lyric.Common.makeTime({ start: startTime, end: endTime })
    }
  }

  /**
   * Extend each line end time to cover the end time of its last background line, ensuring the line duration fully encompasses all background content.
   */
  syncLineTimeWithBackground() {
    for (const line of this.result.lines) {
      if (!Lyric.Parsed.isParsedLineNormal(line)) {
        continue
      }
      const body = line.body.value
      if (!body.backgrounds.length || !body.time) {
        continue
      }

      const last = body.backgrounds[body.backgrounds.length - 1]
      if (!last?.time) {
        continue
      }

      body.time.end = Math.max(body.time.end, last.time.end)
    }
  }

  /**
   * Remove leading and trailing space words from each line's word list.
   */
  cleanWord() {
    for (const line of this.result.lines) {
      if (!Lyric.Parsed.isParsedLineNormal(line)) {
        continue
      }
      const body = line.body.value
      this.cleanContentWord(body.words)
      for (const background of body.backgrounds) {
        this.cleanContentWord(background.words)
      }
    }
  }

  /**
   * Trim leading and trailing space words of one word list.
   */
  private cleanContentWord(words: Lyric.Common.Word[]) {
    if (!words.length) {
      return
    }

    while (words.length > 0 && Lyric.Common.isWordSpace(words[words.length - 1])) {
      words.pop()
    }

    let startCount = 0
    while (startCount < words.length && Lyric.Common.isWordSpace(words[startCount])) {
      startCount++
    }
    if (startCount > 0) {
      words.splice(0, startCount)
    }
  }

  /**
   * Build line annotations from words for every line and its background lines.
   */
  finalizeAnnotation() {
    for (const line of this.result.lines) {
      if (!Lyric.Parsed.isParsedLineNormal(line)) {
        continue
      }
      const body = line.body.value
      Lyric.refreshLineAnnotation(body)
      for (const background of body.backgrounds) {
        Lyric.refreshLineAnnotation(background)
      }
    }
  }
}
