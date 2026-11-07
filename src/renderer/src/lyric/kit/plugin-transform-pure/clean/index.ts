import type { DeepPartial } from '../../utils'
import type { CleanConfig } from './config'

import { DEFAULT_CONFIG } from './config'
import { DEFAULT_RULES } from './constants'

import { ConfigManager } from '../../utils'
import { Matcher } from '../utils/match'

import { ParserPlugin, ParserContext, PluginStage } from '../../core'
import { Lyric } from '../../lyric'

import { processText } from './utils'

/**
 * [vendor patch] 整行除分隔符/标点外是否都由歌名、歌手构成。
 *
 * 上游把歌名歌手当成普通 rule 交给 exact 阈值（默认 40%）判定，于是歌名恰好是
 * 首行一部分的真歌词会被整行删掉：[00:20.87]皇后大道西又皇后大道东，11 字里命中
 * 歌名「皇后大道东」5 字 = 40% → 首句消失。这里改成「必须整行覆盖」：
 * 「歌名 - 歌手」这种头行仍旧剔除，真歌词留下来。
 */
function isMusicInfoLine(text: string, extra: string[]): boolean {
  let rest = text.toLowerCase()

  for (const item of [...extra].sort((a, b) => b.length - a.length)) {
    const token = item.toLowerCase()
    if (!token) {
      continue
    }
    rest = rest.split(token).join('')
  }

  return !/[\p{L}\p{N}]/u.test(rest)
}

export class Clean extends ParserPlugin {
  private matcher: Matcher

  override config = new ConfigManager<CleanConfig, DeepPartial<CleanConfig>>(DEFAULT_CONFIG)

  override get priority() {
    return 50
  }

  override get id() {
    return 'TRANSFORM-PURE-CLEAN'
  }

  override get stage() {
    return PluginStage.Transform
  }

  constructor() {
    super()
    this.matcher = Matcher.create(this.config.current, DEFAULT_RULES)
    this.config.event.add('update', (keys, opt) => {
      this.matcher = this.matcher.update(opt)
    })
  }

  override check(ctx: ParserContext) {
    return true
  }

  override exec(ctx: ParserContext) {
    const lines = ctx.result.lines
    const linesLength = lines.length
    if (!linesLength) {
      return
    }

    const newLines: Lyric.Parsed.ParsedLine[] = []

    const musicInfo = ctx.params.musicInfo

    for (let i = 0; i < linesLength; i++) {
      const line = lines[i]
      if (!Lyric.Parsed.isParsedLineNormal(line)) {
        newLines.push(line)
        continue
      }

      let extra: string[] | undefined
      if (i === 0 && musicInfo && this.config.current.firstLineWithMusicInfo) {
        extra = [...processText(musicInfo.name || '')]
        if (musicInfo.singer) {
          for (const item of musicInfo.singer) {
            extra.push(...processText(item))
          }
        }
        // [vendor patch] 只有整行几乎全由歌名/歌手构成时才交给 matcher，见 isMusicInfoLine
        if (extra.length && !isMusicInfoLine(Lyric.Parsed.getParsedLineText(line), extra)) {
          extra = undefined
        }
      }

      const clean = extra?.length
        ? processText(Lyric.Parsed.getParsedLineText(line)).join('')
        : Lyric.Parsed.getParsedLineText(line)
      const result = this.matcher.match(clean, extra)
      if (!result) {
        newLines.push(line)
      }
    }

    ctx.result.lines = newLines
  }
}

export type { CleanConfig }
