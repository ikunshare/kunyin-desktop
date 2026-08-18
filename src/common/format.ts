/**
 * 跨端共享的显示/命名格式化。
 *
 * 各音源给的发行时间格式互不相同：QQ/酷狗/酷我是 `yyyy-MM-dd`（酷狗还可能带时分秒），
 * 网易云给的是**毫秒时间戳**。直接拿正则取前四位会把 `1546272000000` 读成 1546 年，
 * 故统一在此归一化，专辑年份显示、专辑排序、整专下载目录名共用。
 */

/** 发行时间归一化为毫秒时间戳；无法识别返回 0。 */
export function publishTimestamp(publishTime: string | number | undefined | null): number {
  if (publishTime == null) return 0
  const s = String(publishTime).trim()
  if (!s || s.startsWith('0000')) return 0
  if (/^\d+$/.test(s)) {
    // 纯数字：yyyy / yyyyMM / yyyyMMdd 当日期看，10 位为秒级、更长为毫秒级时间戳
    if (s.length <= 8) {
      const y = Number(s.slice(0, 4))
      const m = Number(s.slice(4, 6) || '1')
      const d = Number(s.slice(6, 8) || '1')
      return y > 1000 ? new Date(y, (m || 1) - 1, d || 1).getTime() : 0
    }
    const n = Number(s)
    if (!Number.isFinite(n) || n <= 0) return 0
    return s.length <= 10 ? n * 1000 : n
  }
  const m = /^(\d{4})(?:[-/.](\d{1,2})(?:[-/.](\d{1,2}))?)?/.exec(s)
  if (!m) return 0
  return new Date(Number(m[1]), Number(m[2] ?? 1) - 1, Number(m[3] ?? 1)).getTime()
}

/** 发行时间 → 四位年份字符串；无法识别返回空串。 */
export function publishYear(publishTime: string | number | undefined | null): string {
  const ts = publishTimestamp(publishTime)
  if (!ts) return ''
  const y = new Date(ts).getFullYear()
  return y > 1000 && y < 2200 ? String(y) : ''
}

/**
 * 整专下载的目录名：`年份 艺人 - 专辑名`（年份或艺人缺失时对应片段省略）。
 * 非法路径字符由下载端统一过滤。
 */
export function albumFolderName(album: {
  name: string
  artist?: string
  publishTime?: string | number
}): string {
  const name = (album.name || '').trim() || '未知专辑'
  const artist = (album.artist || '').trim()
  const year = publishYear(album.publishTime)
  const head = [year, artist].filter(Boolean).join(' ')
  return head ? `${head} - ${name}` : name
}
