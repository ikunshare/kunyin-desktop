/** Best-effort diagnostic redaction, not a guarantee that logs contain no personal data. */
const SECRET =
  /cookie|ticket|token|auth|passw|secret|credential|session|ekey|cdk|sign|key|uin|code|refresh/i
export function maskSecret(_value: unknown): string {
  return '[REDACTED]'
}
export function maskUrl(value: unknown): string {
  try {
    const u = new URL(String(value))
    return `${u.protocol}//${u.host}/[path omitted]${u.search ? '?[query omitted]' : ''}`
  } catch {
    return '[URL omitted]'
  }
}
export function sanitizeText(value: unknown, limit = 2000): string {
  if (typeof value !== 'string') return '[non-string]'
  return value
    .slice(0, 16000)
    .replace(/(?:https?|blob|kunyin|file):[^\s"'<>]+/gi, (url) => maskUrl(url))
    .replace(/\b(?:Bearer|Basic)\s+[^\s,;"']+/gi, '[authorization omitted]')
    .replace(/\b(?:cookie|set-cookie|authorization)\s*[:=][^\r\n]+/gi, '[credentials omitted]')
    .replace(
      /(\b[\w-]{0,60}(?:cookie|ticket|token|password|passwd|secret|credential|session|ekey|cdk|sign|key|auth|uin)[\w-]{0,40}["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s&,;}]+)/gi,
      '$1[REDACTED]'
    )
    .replace(/\?[^\s"'<>]+/g, '?[query omitted]')
    .replace(/[\r\n\u0000-\u001f]/g, ' ')
    .slice(0, limit)
}
export function redact(value: unknown): unknown {
  let budget = 160
  function visit(v: unknown, depth: number): unknown {
    if (--budget < 0 || depth > 4) return '[omitted]'
    if (v == null || typeof v === 'boolean' || typeof v === 'number') return v
    if (typeof v === 'string') return sanitizeText(v, 1000)
    if (typeof v !== 'object') return `[${typeof v}]`
    if (v instanceof Error)
      return {
        name: sanitizeText(v.name),
        message: sanitizeText(v.message),
        stack: sanitizeText(v.stack ?? '', 3000)
      }
    if (ArrayBuffer.isView(v)) return '[binary omitted]'
    if (Array.isArray(v)) return v.slice(0, 20).map((x) => visit(x, depth + 1))
    const out: Record<string, unknown> = Object.create(null)
    let count = 0
    for (const key in v) {
      if (!Object.prototype.hasOwnProperty.call(v, key)) continue
      if (++count > 30 || budget < 0) break
      const desc = Object.getOwnPropertyDescriptor(v, key)
      out[sanitizeText(key, 80)] = SECRET.test(key)
        ? maskSecret(null)
        : desc && 'value' in desc
          ? visit(desc.value, depth + 1)
          : '[accessor omitted]'
    }
    return out
  }
  try {
    return visit(value, 0)
  } catch {
    return '[unreadable]'
  }
}
