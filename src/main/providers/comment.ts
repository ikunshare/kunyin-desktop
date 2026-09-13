/**
 * 评论抓取的共享工具（各音源 providers/<source>/comment.ts 复用）。
 *
 * 各家接口给的时间五花八门：wy 毫秒戳、kw 秒级字符串、qq 秒级但偶尔给的是
 * 非时间的自增值、kg 直接给 `yyyy-MM-dd HH:mm:ss` 文本。统一在此归一化成
 * 「毫秒时间戳 + 显示文案」两个字段，渲染层不再做任何时间解析。
 */

/** 毫秒时间戳 → `yyyy-MM-dd HH:mm:ss`（对应 LX 的 dateFormat2）；无效返回空串 */
export function commentTimeStr(ms: number): string {
  if (!ms || !Number.isFinite(ms)) return ''
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/**
 * 秒级时间戳 → 毫秒。位数不足 10 的一律视为「不是时间」返回 0——
 * qq 的 `time` 字段在部分楼层里放的是自增序号，直接 ×1000 会得到 1970 年。
 */
export function secToMs(time: string | number | undefined | null): number {
  const s = String(time ?? '')
  if (s.length < 10 || !/^\d+$/.test(s)) return 0
  return Number(s) * 1000
}

/** 计算总页数，至少 1 页 */
export function maxPageOf(total: number, limit: number): number {
  return Math.ceil((total || 0) / limit) || 1
}
