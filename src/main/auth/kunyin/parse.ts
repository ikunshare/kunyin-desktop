/**
 * 网页版坤音账号相关接口的响应解析（纯函数，不 import electron）。
 * 回归在 tools/kunyinAccount.test.mjs。
 */
import type { KunyinAccount, KunyinKey, KunyinKeyQuota, LocalQQAccount } from '@common'

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const obj = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {}

function parseQuota(v: unknown): KunyinKeyQuota {
  const q = obj(v)
  return {
    limit: num(q.limit),
    used: num(q.used),
    periodDays: num(q.periodDays),
    resetAt: str(q.resetAt),
    exceeded: q.exceeded === true
  }
}

function parseKey(v: unknown): KunyinKey | null {
  const k = obj(v)
  const key = str(k.key)
  if (!key) return null
  return {
    key,
    type: str(k.type),
    isActive: k.isActive === true,
    version: num(k.version),
    expiresAt: str(k.expiresAt),
    createdAt: str(k.createdAt),
    usageCount: num(k.usageCount),
    boundQQ: num(k.boundQQ),
    quota: parseQuota(k.quota)
  }
}

/** GET /user/me 的信封 → KunyinAccount。未登录时 loggedIn=false、keys 为空。 */
export function parseUserMe(body: unknown): KunyinAccount {
  const data = obj(obj(body).data)
  const loggedIn = data.logged_in === true
  const keys = loggedIn && Array.isArray(data.keys) ? data.keys : []
  return {
    loggedIn,
    musicid: num(data.musicid),
    nickname: str(data.nickname),
    avatar: str(data.avatar),
    encryptUin: str(data.encryptUin),
    expiredAt: num(data.expired_at),
    keys: keys.map(parseKey).filter((k): k is KunyinKey => k !== null)
  }
}

/** 本机 QQ 客户端 /quick_login/accounts 的原始响应 → 账号列表。 */
export function parseLocalAccounts(body: unknown): LocalQQAccount[] {
  const list = obj(body).uins
  if (!Array.isArray(list)) return []
  return list
    .map((it) => {
      const a = obj(it)
      const uin = String(a.uin ?? '')
      return { uin, nickname: str(a.nickname), avatar: str(a.avatar_url) }
    })
    .filter((a) => a.uin !== '')
}

/** 从 set-cookie 里取出指定 cookie 的 `name=value`；没有就返回空串。 */
export function pickCookie(setCookie: string[], name: string): string {
  for (const line of setCookie) {
    const head = line.split(';', 1)[0].trim()
    if (head.startsWith(`${name}=`)) return head
  }
  return ''
}

/** 从 app/authorize 的 redirectUri 里取 OAuth code。 */
export function parseRedirectCode(redirectUri: string): string {
  if (!redirectUri) return ''
  try {
    return new URL(redirectUri).searchParams.get('code') ?? ''
  } catch {
    const m = /[?&]code=([^&#]+)/.exec(redirectUri)
    return m ? decodeURIComponent(m[1]) : ''
  }
}

/**
 * app/scope 响应 → app/authorize 需要的 scopes / auth_groups。
 * 面板的规则：取必选（authFlag=1）与默认勾选（authFlag=2 且 showFlag≠0）的授权组，
 * scopes 是这些组声明范围的并集。
 */
export function pickAuthGroups(scopeBody: unknown): { scopes: string[]; authGroups: number[] } {
  const data = obj(obj(scopeBody).data ?? obj(scopeBody))
  const groups = Array.isArray(data.apiAuthGroups) ? data.apiAuthGroups : []
  const scopes = new Set<string>()
  const authGroups: number[] = []
  for (const raw of groups) {
    const g = obj(raw)
    const id = num(g.authGroupId)
    const flag = num(g.authFlag)
    const show = num(g.showFlag)
    if (!(id > 0) || !(flag === 1 || flag === 2) || show === 0) continue
    authGroups.push(id)
    const detail = Array.isArray(g.scopeDetail) ? g.scopeDetail : []
    for (const d of detail) {
      const s = str(obj(d).scope)
      if (s) scopes.add(s)
    }
    if (detail.length === 0 && str(g.scopeList)) {
      try {
        const parsed: unknown = JSON.parse(str(g.scopeList))
        if (Array.isArray(parsed))
          for (const s of parsed) if (typeof s === 'string' && s) scopes.add(s)
      } catch {
        /* scopeList 不是合法 JSON：这组不带 scope，跳过 */
      }
    }
  }
  return { scopes: [...scopes], authGroups }
}

/** 后端 `{code,message}` 信封的错误文案；没有 message 时按 HTTP 状态兜底。 */
export function envelopeMessage(body: unknown, status: number): string {
  const message = str(obj(body).message)
  return message || `请求失败 (HTTP ${status})`
}
