/**
 * 逐字歌词翻译/音译时间轴重对齐。
 *
 * music-lyric-kit 的 LRC 解析按「行起始毫秒完全相等」（0 容差）把翻译/音译挂到主歌词行。
 * 但部分音源（尤其 QQ QRC）的主 lyric 与 trans/roma 是各自独立解密的 QRC，行时间戳会相差
 * 几毫秒，导致大量行匹配失败、时间轴看起来「全错」。
 *
 * 由于同一首歌的主/译/音译行是 1:1 顺序对应，这里在喂给 kit 前，按「行索引」把副轨（trans/roma）
 * 的每行时间戳改写成主轨对应行的时间戳，从而让 kit 的精确匹配 100% 命中。
 * 行数不一致时（偶发）保持原样，交给 kit 尽力匹配，避免错位放大。
 */

const LINE_TIME_RE = /^\s*\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/

interface LrcLine {
  raw: string
  /** 行起始时间标签字符串（含中括号），无时间行为 null */
  timeTag: string | null
  /** 时间标签之后的正文 */
  rest: string
}

function splitLines(lrc: string): LrcLine[] {
  return lrc.split('\n').map((raw) => {
    const m = LINE_TIME_RE.exec(raw)
    if (!m) return { raw, timeTag: null, rest: raw }
    const tag = m[0].trimStart()
    return { raw, timeTag: tag, rest: raw.slice(m[0].length) }
  })
}

/** 提取有时间标签的行（顺序保留） */
function timedLines(lines: LrcLine[]): LrcLine[] {
  return lines.filter((l) => l.timeTag != null)
}

/**
 * 把 sub 的每个带时间行的时间标签，按索引替换为 main 对应带时间行的时间标签。
 * main/sub 的带时间行数必须相等才重对齐，否则原样返回。
 */
export function realignByIndex(main: string, sub: string): string {
  if (!sub.trim() || !main.trim()) return sub
  const mainTimed = timedLines(splitLines(main))
  const subLines = splitLines(sub)
  const subTimed = subLines.filter((l) => l.timeTag != null)
  if (mainTimed.length === 0 || mainTimed.length !== subTimed.length) return sub

  let i = 0
  const out = subLines.map((l) => {
    if (l.timeTag == null) return l.raw
    const mainTag = mainTimed[i]?.timeTag ?? l.timeTag
    i++
    return `${mainTag}${l.rest}`
  })
  return out.join('\n')
}
