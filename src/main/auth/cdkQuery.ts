/**
 * 卡密自查接口（POST https://c.wwwweb.top/cdk/query）的响应解析。
 * 纯函数、不 import electron，回归在 tools/cdkQuery.test.mjs。
 *
 * 成功是 HTTP 200 + `{code: 200, message, data}`；失败时 body 的 code 与 HTTP 状态一致、
 * 只带 message：400 缺卡密 / 404 卡密不存在 / 403 IP 黑名单 / 429 限流 / 503 CDK 未启用 /
 * 500 后端出错（只给通用提示）。这些 message 都能直接展示。
 */
import type { CdkInfo, CdkQueryResult } from '@common'

const FALLBACK_ERROR = '查询失败，请稍后重试'

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const obj = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {}

/** 把接口返回的 JSON 收拢成 CdkQueryResult：只取持卡人字段，类型不对的按缺省值处理。 */
export function parseCdkQuery(body: unknown): CdkQueryResult {
  const resp = obj(body)
  const message = str(resp.message)
  if (resp.code !== 200) return { ok: false, message: message || FALLBACK_ERROR }
  // code 200 却没有 data 是结构不对，此时的 message（多半是「卡密有效」）不能当失败原因展示
  if (typeof resp.data !== 'object' || resp.data === null) {
    return { ok: false, message: FALLBACK_ERROR }
  }
  const data = obj(resp.data)
  const quota = obj(data.quota)
  const info: CdkInfo = {
    type: str(data.type),
    state: str(data.state),
    activatedAt: str(data.activatedAt),
    expiresAt: str(data.expiresAt),
    quota: {
      limit: num(quota.limit),
      used: num(quota.used),
      periodDays: num(quota.periodDays),
      resetAt: str(quota.resetAt),
      exceeded: quota.exceeded === true
    }
  }
  return { ok: true, message, info }
}
