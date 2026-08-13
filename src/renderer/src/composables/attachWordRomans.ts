/**
 * 逐字音译（chroma / 带 <mm:ss.xxx> 的 roma）挂接到主歌词 word.annotation.romans。
 *
 * music-lyric-kit 的 LRC 解析对 roman 轨强制 forceNormal，会把
 *   [00:06.856]<00:06.856>yei <00:07.196>in ...
 * 整段（含时间标签）塞进行级 annotation.romans.content，导致界面上出现
 * 「逐字时间戳原样展示 / 无法当逐字音译用」。
 *
 * 正确路径（对齐 TTML attachWordRomans）：
 * 1. 行级音译喂 kit 前先剥掉 <...> 时间标记，只保留干净拼音文本
 * 2. 用带时间戳的音译轨单独解析为音节词
 * 3. 按行索引 + 词起始时间对齐，挂到主歌词每个 word 的 annotation.romans
 */
import { Lyric, ParserPipeline } from 'music-lyric-kit'

const SYLLABLE_TAG_RE = /<[^>]+>/

/** 是否含逐字时间标签（增强 LRC） */
export function hasSyllableTags(text: string): boolean {
  return !!text && SYLLABLE_TAG_RE.test(text)
}

/**
 * 剥掉行内 <mm:ss.xxx> / <off,dur> 时间标记，保留行首 [mm:ss.xxx]。
 * 空白折叠成单空格，供 kit 行级 roman 使用。
 */
export function stripSyllableTags(lrc: string): string {
  if (!lrc.trim() || !hasSyllableTags(lrc)) return lrc
  return lrc
    .split('\n')
    .map((line) =>
      line
        .replace(/<[^>]+>/g, '')
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/\][ \t]+/g, ']')
        .trimEnd()
    )
    .join('\n')
}

type WordNormalValue = Lyric.Common.WordNormal

/** 主/背景行的 body.value（含 words / time / annotation） */
type LineBody = {
  words: Lyric.Common.Word[]
  time?: Lyric.Common.Time
  annotation?: Lyric.Common.LineAnnotation
  backgrounds?: { words: Lyric.Common.Word[] }[]
}

function normalWordsOf(line: LineBody): WordNormalValue[] {
  const out: WordNormalValue[] = []
  for (const w of line.words) {
    if (Lyric.Common.isWordNormal(w)) out.push(w.body.value)
  }
  return out
}

function findTargetWord(
  mainWords: WordNormalValue[],
  startMap: Map<number, WordNormalValue>,
  start: number,
  end: number
): WordNormalValue | undefined {
  const exact = startMap.get(start)
  if (exact) return exact

  // 最大时间重叠；end==start 时退化为最近起始时间
  let best: WordNormalValue | undefined
  let bestScore = -1
  for (const word of mainWords) {
    const t = word.time
    if (!t) continue
    const wordEnd = t.end > t.start ? t.end : t.start + 1
    const spanEnd = end > start ? end : start + 1
    const overlap = Math.min(spanEnd, wordEnd) - Math.max(start, t.start)
    if (overlap > bestScore) {
      bestScore = overlap
      best = word
    } else if (overlap === bestScore && best) {
      const dNew = Math.abs(t.start - start)
      const dOld = Math.abs((best.time?.start ?? 0) - start)
      if (dNew < dOld) best = word
    }
  }
  if (bestScore > 0) return best

  let nearest: WordNormalValue | undefined
  let nearestDiff = Infinity
  for (const word of mainWords) {
    const d = Math.abs((word.time?.start ?? 0) - start)
    if (d < nearestDiff) {
      nearestDiff = d
      nearest = word
    }
  }
  return nearest
}

/**
 * 把 syllable-timed 音译轨挂到已解析主歌词的 word.annotation.romans。
 * @returns 是否成功挂上至少一处逐字音译
 */
export function attachWordRomans(result: Lyric.Parsed.Info, romanLrc: string): boolean {
  if (!hasSyllableTags(romanLrc)) return false

  let romanInfo: Lyric.Parsed.Info
  try {
    const pipeline = new ParserPipeline({
      content: { original: romanLrc },
      format: 'lrc'
    }).parse()
    romanInfo = pipeline.final().result
  } catch (e) {
    console.warn('[lyric] 逐字音译轨解析失败', e)
    return false
  }

  const mainLines = result.lines.filter(Lyric.Parsed.isParsedLineNormal)
  const romanLines = romanInfo.lines.filter(Lyric.Parsed.isParsedLineNormal)
  if (!mainLines.length || !romanLines.length) return false

  const useIndex = mainLines.length === romanLines.length
  const romanByStart = new Map<number, LineBody>()
  if (!useIndex) {
    for (const line of romanLines) {
      const start = line.body.value.time?.start
      if (start != null) romanByStart.set(start, line.body.value)
    }
  }

  let attached = 0

  for (let i = 0; i < mainLines.length; i++) {
    const mainLine = mainLines[i].body.value
    let romanLine: LineBody | undefined
    if (useIndex) {
      romanLine = romanLines[i]?.body.value
    } else {
      const start = mainLine.time?.start
      if (start == null) continue
      romanLine = romanByStart.get(start)
      if (!romanLine) {
        let bestDiff = 151
        for (const rl of romanLines) {
          const rs = rl.body.value.time?.start
          if (rs == null) continue
          const d = Math.abs(rs - start)
          if (d < bestDiff) {
            bestDiff = d
            romanLine = rl.body.value
          }
        }
      }
    }
    if (!romanLine) continue

    const mainWords = normalWordsOf(mainLine)
    const romanWords = normalWordsOf(romanLine)
    if (!mainWords.length || !romanWords.length) continue

    const startMap = new Map<number, WordNormalValue>()
    for (const w of mainWords) {
      if (w.time) startMap.set(w.time.start, w)
    }

    const groups = new Map<WordNormalValue, Lyric.Common.WordAnnotationContent[]>()

    for (const rw of romanWords) {
      const start = rw.time?.start ?? 0
      const end = rw.time?.end ?? start
      const target = findTargetWord(mainWords, startMap, start, end)
      if (!target) continue
      const token = Lyric.Common.makeWordAnnotationContent({
        content: rw.content,
        time: Lyric.Common.makeTime({ start, end })
      })
      const list = groups.get(target)
      if (list) list.push(token)
      else groups.set(target, [token])
    }

    if (!groups.size) continue

    for (const [word, tokens] of groups) {
      // 音译轨的时间戳与主词往往差几十毫秒，而 dom 引擎给逐字音译强制独立擦除时钟
      // （word.ts 硬传 forceOwnWipe=true，config 无法关闭），时间窗一旦不同，
      // 主词与它下方的拼音就各擦各的——即「主词播主词的、音译播音译的」。
      // 一字对一音节时直接采用主词时间窗，两条时钟走同一区间，视觉上完全同步；
      // 一字对多音节（连读）保留音译自身时间，逐音节擦除才是对的。
      const wordTime = word.time
      const words =
        tokens.length === 1 && wordTime
          ? [
              Lyric.Common.makeWordAnnotationContent({
                content: tokens[0].content,
                time: Lyric.Common.makeTime({ start: wordTime.start, end: wordTime.end })
              })
            ]
          : tokens
      const item = Lyric.Common.makeWordAnnotationRoman({
        words,
        time: Lyric.Common.makeTime({
          start: words[0].time?.start ?? 0,
          end: words[words.length - 1].time?.end ?? 0
        })
      })
      word.annotation ??= Lyric.Common.makeWordAnnotation()
      word.annotation.romans = [item]
      attached++
    }

    const parts: string[] = []
    for (const w of mainWords) {
      const roman = w.annotation?.romans?.[0]
      if (!roman?.words?.length) continue
      parts.push(roman.words.map((t) => t.content).join(''))
    }
    if (parts.length) {
      const annotation =
        mainLine.annotation ?? (mainLine.annotation = Lyric.Common.makeLineAnnotation())
      annotation.romans = [Lyric.Common.makeLineAnnotationRoman({ content: parts.join(' ') })]
    }
  }

  return attached > 0
}

/**
 * 时间标签 `mm:ss` / `mm:ss.xxx` → ms。
 *
 * 只认 `.` 作毫秒分隔：kit 把 `00:10:000` 解析为 mm:ss（10 分整），若这里按
 * mm:ss:xxx 算成 10 秒，两边行起始时间对不上、索引整个失效。以 kit 的解释为准。
 */
function parseTimeTag(tag: string): number | null {
  const m = /^(\d+):(\d+(?:\.\d+)?)$/.exec(tag.trim())
  if (!m) return null
  return Number(m[1]) * 60000 + Math.round(Number(m[2]) * 1000)
}

/**
 * 从原始增强 LRC 取每行「行起始时间 → 行末时间标签」。
 *
 * kit 把行的 time.end 设为末词的 start（而非行尾标签），末字于是没有可用的结束时间。
 * 而 `<00:12.800>` 这种收尾标签恰恰是末字唱完的时刻，只能从原文里捞。
 */
function collectLineEnds(lrc: string): Map<number, number> {
  const out = new Map<number, number>()
  for (const raw of lrc.split(/\r?\n/)) {
    const head = /^\[(\d+:\d+(?:\.\d+)?)\]/.exec(raw)
    if (!head) continue
    const start = parseTimeTag(head[1])
    if (start == null) continue
    // 取该行最后一个 <...> 标签作为收尾
    const tags = raw.match(/<([^>]+)>/g)
    if (!tags?.length) continue
    const last = parseTimeTag(tags[tags.length - 1].slice(1, -1))
    if (last == null) continue
    const prev = out.get(start)
    if (prev == null || last > prev) out.set(start, last)
  }
  return out
}

/**
 * 补全绝对时间标签解析后 end==start 的词时长（下一词 start → 本词 end）。
 * kit 对 <mm:ss.xxx> 格式不写 duration，影响卡拉 OK 擦除与重音。
 *
 * @param sourceLrc 原始增强 LRC，用于取行末时间标签补末字时长（见 collectLineEnds）
 */
export function reconstructWordDurations(result: Lyric.Parsed.Info, sourceLrc = ''): void {
  const lineEnds = sourceLrc ? collectLineEnds(sourceLrc) : null
  for (const line of result.lines) {
    if (!Lyric.Parsed.isParsedLineNormal(line)) continue
    const time = line.body.value.time
    // 行末标签优先；没有原文时退回 kit 的 time.end
    const lineEnd = (time?.start != null ? lineEnds?.get(time.start) : undefined) ?? time?.end
    fixWords(line.body.value.words, lineEnd)
    for (const bg of line.body.value.backgrounds ?? []) {
      fixWords(bg.words, lineEnd)
      // 背景子行有独立 time（extract 时取自末词未补全的 end，偏早）；
      // 引擎按它归一化整行擦除进度，不延长会让背景末词与前一词关键帧重合、动画跳变。
      extendLineEnd(bg)
    }
    extendLineEnd(line.body.value)
  }
}

/**
 * 把行 end 延长到末词 end。
 *
 * kit 把行 time.end 设成末词的 **start**，于是 lineDuration 短了末字一整拍。
 * 引擎按 lineDuration 把每个字的擦除进度归一化到 [0,1]，末字算出的 offset 会 >1
 * 被 clamp 成 1，与前一字的关键帧重合、零间距——就是「尾字直接跳过去、没有动画」。
 */
function extendLineEnd(value: LineBody): void {
  const time = value.time
  if (!time) return
  let max = time.end
  for (const w of value.words) {
    if (!Lyric.Common.isWordNormal(w)) continue
    const end = w.body.value.time?.end
    if (end != null && end > max) max = end
  }
  for (const bg of value.backgrounds ?? []) {
    for (const w of bg.words) {
      if (!Lyric.Common.isWordNormal(w)) continue
      const end = w.body.value.time?.end
      if (end != null && end > max) max = end
    }
  }
  if (max > time.end) time.end = max
}

/**
 * @param lineEnd 行结束时间。末字没有「下一词」可依，只能估时长，估短了擦除动画
 *   还没走完行就切走——即「最后一个字莫名闪过去、没有动画」。
 */
function fixWords(words: Lyric.Common.Word[] | undefined, lineEnd?: number): void {
  if (!words?.length) return
  const normals = words.filter(Lyric.Common.isWordNormal).map((w) => w.body.value)
  for (let i = 0; i < normals.length; i++) {
    const t = normals[i].time
    if (!t || t.end > t.start) continue
    // 取下一词 start 作本词 end。但 kit 的 normalizeBoundaryPunct 会把边界标点
    // 拆成独立词并复制前词时间（good- → good + "-"，两词 start 相同），
    // 此时 next > t.start 不成立，若直接兜底行末，本词会吞掉整行剩余时长
    // （QQ 316639030 "Wave good-bye"：good 被补成 6478ms，其后所有词的擦除
    // 关键帧全堆到行尾 → 整行看似没有高亮）。故向后跳过同刻词，取第一个更晚的。
    let next: number | undefined
    for (let j = i + 1; j < normals.length; j++) {
      const s = normals[j].time?.start
      if (s != null && s > t.start) {
        next = s
        break
      }
    }
    if (next != null) {
      t.end = next
      continue
    }
    // 末字：行末标签优先，否则按字数估
    t.end =
      lineEnd != null && lineEnd > t.start
        ? lineEnd
        : t.start + estimateDuration(normals[i].content)
  }
}

function estimateDuration(content: string): number {
  if (!content || !content.trim()) return 100
  if (content.length === 1) return 250
  return Math.min(800, 200 * content.length)
}
