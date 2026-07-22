/* eslint-disable */
// 颜色明暗/透明度派生。移植自 lx-music-desktop src/common/theme/colorUtils.js（Apache-2.0, © lyswhut）。
// 源自 PJs pSBC 的 micro-functions。

/**
 * Shade：变亮或变暗。p ∈ [-1,1]，负偏黑、正偏白。c0 为 rgb(a) 字符串。
 */
export function RGB_Linear_Shade(p: number, c0: string): string {
  const i = parseInt,
    r = Math.round,
    [a, b, c, d] = c0.split(','),
    n = p < 0,
    t = n ? 0 : 255 * p,
    P = n ? 1 + p : 1 - p
  return (
    'rgb' +
    (d ? 'a(' : '(') +
    r(i(a[3] == 'a' ? a.slice(5) : a.slice(4)) * P + t) +
    ',' +
    r(i(b) * P + t) +
    ',' +
    r(i(c) * P + t) +
    (d ? ',' + d : ')')
  )
}

/**
 * 修改透明度。p ∈ [-1,1]。color 为 rgb(a) 字符串，返回 rgba。
 */
export function RGB_Alpha_Shade(p: number, color: string): string {
  const i = parseInt
  const n = p < 0
  let [r, g, b, a] = color.split(',') as unknown as [string, string, string, string | undefined]
  r = r[3] == 'a' ? r.slice(5) : r.slice(4)
  let av: number
  if (a) {
    av = parseFloat(a)
    av = av - (n ? (1 - av) * p : av * p)
    av = n ? Math.max(0, av) : Math.min(1, av)
  } else {
    av = 1 - p
    av = Math.min(1, av)
  }
  return `rgba(${i(r)}, ${i(g)}, ${i(b)}, ${av.toFixed(2)})`
}
