import { Lyric } from '../../lyric'

import { formatTime } from '../../utils'

export const exportLines = (info: Lyric.Parsed.Info) => {
  // [vendor patch] 标注 string[]：空数组字面量在 strict 下推断为 never[]，
  // 上游未开 noImplicitAny 故不报错。仅补类型，逻辑不动。
  const original: string[] = []
  const syllable: string[] = []
  const translate: string[] = []
  const roman: string[] = []

  for (const line of info.lines) {
    if (!Lyric.Parsed.isParsedLineNormal(line)) {
      continue
    }
    const body = line.body.value

    const lineTime = `[${formatTime(body.time?.start ?? 0)}]`

    if (info.timing === Lyric.Common.Timing.WORD) {
      const items = body.words.map((item) => {
        if (Lyric.Common.isWordNormal(item)) {
          const time = formatTime(item.body.value.time?.start ?? 0)
          return `<${time}>${item.body.value.content}`
        }
        if (Lyric.Common.isWordSpace(item)) {
          return ' '.repeat(item.body.value.count)
        }
        return ''
      })

      const syllableLine = `${lineTime}${items.join('')}`
      syllable.push(syllableLine)

      const originalLine = `${lineTime}${Lyric.Parsed.getParsedLineText(line)}`
      original.push(originalLine)
    } else {
      const target = `${lineTime}${Lyric.Parsed.getParsedLineText(line)}`
      original.push(target)
    }

    const annotation = body.annotation
    for (const item of annotation?.translations ?? []) {
      translate.push(`${lineTime}${item.content}`)
    }
    for (const item of annotation?.romans ?? []) {
      roman.push(`${lineTime}${item.content}`)
    }
  }

  return {
    original,
    syllable,
    translate,
    roman
  }
}
