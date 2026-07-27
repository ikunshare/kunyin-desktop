/**
 * 逐字歌词翻译/音译时间轴重对齐。
 *
 * music-lyric-kit 的 LRC 解析按「行起始毫秒完全相等」（0 容差）把翻译/音译挂到主歌词行。
 * 但部分音源（尤其 QQ QRC）的主 lyric 与 trans/roma 是各自独立解密的 QRC，行时间戳会相差
 * 几毫秒（QQ trans 是主轨毫秒时间戳截断到厘秒），导致大量行匹配失败。
 *
 * 两级策略：
 * 1. 主/副轨带时间行数相等 → 按「行索引」1:1 改写副轨时间戳（同一首歌的主/译行顺序对应）。
 * 2. 行数不等（如 QQ trans 混入主轨没有的空时间行）→ 按「时间就近 ±TOLERANCE_MS」把副轨行
 *    吸附到主轨行的时间戳；吸不上的行保持原样（kit 精确匹配不中，等于丢弃，不会错挂）。
 */

const LINE_TIME_RE = /^\s*\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/

/** 时间就近吸附的容差。QQ 厘秒截断误差 <10ms；相邻唱词行间距远大于此，不会吸错行。 */
const TOLERANCE_MS = 50

interface LrcLine {
  raw: string
  /** 行起始时间标签字符串（含中括号），无时间行为 null */
  timeTag: string | null
  /** 时间标签之后的正文 */
  rest: string
  /** 行起始毫秒，无时间行为 null */
  startMs: number | null
}

function splitLines(lrc: string): LrcLine[] {
  return lrc.split('\n').map((raw) => {
    const m = LINE_TIME_RE.exec(raw)
    if (!m) return { raw, timeTag: null, rest: raw, startMs: null }
    const tag = m[0].trimStart()
    return { raw, timeTag: tag, rest: raw.slice(m[0].length), startMs: tagToMs(m) }
  })
}

/** LINE_TIME_RE 命中结果 → 起始毫秒。小数位 1 位=百毫秒、2 位=厘秒、3 位=毫秒。 */
function tagToMs(m: RegExpExecArray): number {
  const min = parseInt(m[1], 10)
  const sec = parseInt(m[2], 10)
  const frac = m[3] ?? ''
  let ms = frac ? parseInt(frac, 10) : 0
  if (frac.length === 1) ms *= 100
  else if (frac.length === 2) ms *= 10
  return min * 60000 + sec * 1000 + ms
}

/** 提取有时间标签的行（顺序保留） */
function timedLines(lines: LrcLine[]): LrcLine[] {
  return lines.filter((l) => l.timeTag != null)
}

/**
 * 把 sub 的每个带时间行的时间标签替换为 main 对应带时间行的时间标签。
 * 行数相等按索引 1:1 替换；不等则按时间就近吸附（±TOLERANCE_MS），吸不上的行原样保留。
 */
export function realignByIndex(main: string, sub: string): string {
  if (!sub.trim() || !main.trim()) return sub
  const mainTimed = timedLines(splitLines(main))
  const subLines = splitLines(sub)
  const subTimed = subLines.filter((l) => l.timeTag != null)
  if (mainTimed.length === 0) return sub

  if (mainTimed.length === subTimed.length) {
    let i = 0
    const out = subLines.map((l) => {
      if (l.timeTag == null) return l.raw
      const mainTag = mainTimed[i]?.timeTag ?? l.timeTag
      i++
      return `${mainTag}${l.rest}`
    })
    return out.join('\n')
  }

  // 行数不等：按时间就近吸附。mainTimed 已按出现顺序排列（LRC 时间单调），可二分。
  const out = subLines.map((l) => {
    if (l.timeTag == null || l.startMs == null) return l.raw
    const nearest = nearestTimed(mainTimed, l.startMs)
    if (!nearest || Math.abs((nearest.startMs as number) - l.startMs) > TOLERANCE_MS) return l.raw
    return `${nearest.timeTag}${l.rest}`
  })
  return out.join('\n')
}

/** 在按时间升序的 timed 行里二分找与 targetMs 最接近的行 */
function nearestTimed(timed: LrcLine[], targetMs: number): LrcLine | null {
  if (!timed.length) return null
  let lo = 0
  let hi = timed.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if ((timed[mid].startMs as number) < targetMs) lo = mid + 1
    else hi = mid
  }
  const cand = timed[lo]
  const prev = lo > 0 ? timed[lo - 1] : null
  if (
    prev &&
    Math.abs((prev.startMs as number) - targetMs) < Math.abs((cand.startMs as number) - targetMs)
  ) {
    return prev
  }
  return cand
}
