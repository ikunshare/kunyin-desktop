/**
 * 封面 URL 处理：直接交给 <img>，由 Chromium 自己的 HTTP 磁盘缓存负责复用
 * （与 lx-music 一致——它没有任何封面缓存代码，重启后封面依旧秒出靠的就是这个）。
 *
 * 曾经走主进程的 `kunyin://cover/<enc>` 磁盘缓存协议，但那条路要在主进程手设 Referer，
 * 而 Chromium 对「显式设置 Referer 头 + 默认 referrerPolicy」判定冲突并回 ERR_BLOCKED_BY_CLIENT，
 * 于是每张封面都成了 502。实测五大平台封面 <img> 直连均 200、无需 Referer，故去掉那一层。
 *
 * 一般将 http 升级为 https；但酷我 sycdn 的 HTTPS 入口会返回 514 Frequency Capped，
 * 而接口给出的原始 HTTP 地址可正常访问，因此该域名必须保留/恢复为 http。
 */
export function coverUrl(url: string | undefined | null): string {
  if (!url) return ''
  if (/^https?:\/\/[^/]+\.sycdn\.kuwo\.cn\//i.test(url)) {
    return url.replace(/^https:/i, 'http:')
  }
  return url.startsWith('http://') ? `https://${url.slice(7)}` : url
}
