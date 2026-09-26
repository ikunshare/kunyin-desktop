/**
 * 轻量逐行 LRC 解析：只取「时间 → 一行纯文本」，给蓝牙歌词这类只要当前一句的场景用。
 *
 * 不走 music-lyric-kit：那条管线是为逐字渲染准备的（翻译对齐、制作人提取、间奏插入……），
 * 这里每首歌只需要一张按时间排好的表加二分查找。纯函数、不 import 任何运行时，
 * 所以能被 `node --test` 直接跑（tools/lrcLines.test.mjs）。
 */

export interface LrcLine {
  /** 行起始时间（ms，已应用 [offset:]） */
  time: number
  /** 纯文本；空串 = 间奏/空行，调用方据此回落到歌名 */
  text: string
}

/** 行首时间标签：[mm:ss] / [mm:ss.xx] / [mm:ss.xxx] / [mm:ss:xx] */
const TIME_TAG_RE = /^\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/

function tagToMs(min: string, sec: string, frac: string | undefined): number {
  // 小数位按位数折算：.5 = 500ms、.05 = 50ms、.005 = 5ms
  const ms = frac ? Math.round(Number(frac) * 10 ** (3 - frac.length)) : 0
  return Number(min) * 60_000 + Number(sec) * 1000 + ms
}

/**
 * 解析 LRC 为按时间升序的行表。
 * - 一行多个时间标签（`[00:10.00][01:20.00]副歌`）展开成多条；
 * - 行内的逐字标签（增强 LRC 的 `<mm:ss.xx>`、`<start,dur,0>`）剥掉只留字；
 * - `[ti:]` `[ar:]` 等元信息行跳过；`[offset:]` 按 LRC 约定生效（正值 = 歌词提前）。
 */
export function parseLrcLines(lrc: string): LrcLine[] {
  if (!lrc) return []
  const lines: LrcLine[] = []
  let offset = 0
  for (const raw of lrc.split(/\r?\n/)) {
    let rest = raw.trim()
    const off = /^\[offset:\s*([+-]?\d+)\s*\]$/i.exec(rest)
    if (off) {
      offset = Number(off[1])
      continue
    }
    const times: number[] = []
    let m: RegExpExecArray | null
    while ((m = TIME_TAG_RE.exec(rest))) {
      times.push(tagToMs(m[1], m[2], m[3]))
      rest = rest.slice(m[0].length)
    }
    if (!times.length) continue
    const text = rest
      .replace(/<[^>]*>/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    for (const time of times) lines.push({ time, text })
  }
  if (offset) for (const l of lines) l.time = Math.max(0, l.time - offset)
  // 稳定排序：同一时间点的多行保持原文顺序
  return lines.sort((a, b) => a.time - b.time)
}

/** 找 `ms` 时刻正在唱的那一行的下标；还没到第一行返回 -1 */
export function lineIndexAt(lines: readonly LrcLine[], ms: number): number {
  let lo = 0
  let hi = lines.length - 1
  let ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (lines[mid].time <= ms) {
      ans = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return ans
}
