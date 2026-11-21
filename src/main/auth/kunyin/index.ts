/**
 * 网页版坤音账号：QQ 登录（本机快捷登录 / 后端代理扫码）+ 名下卡密管理。
 *
 * 快捷登录的完整链路都在主进程里跑：
 *   本机 QQ 客户端（localhost.ptlogin2.qq.com:4301~4309）拿账号与 client_key
 *   → graph.qq.com/connect/api/v1 换 OAuth code
 *   → POST c.wwwweb.top/user/quick/login，后端换 musickey 并下发 qq_auth cookie。
 * 本地服务只接受 `Origin: https://graph.qq.com` 且返回 JSON（不是 JSONP），浏览器读不到，
 * 这也是网页端只能扫码、桌面端能做快捷登录的原因。
 *
 * 会话 cookie 用 safeStorage 加密落盘到 data/kunyin.bin，后续请求手动带 Cookie 头。
 */
import { safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import type {
  KunyinAccount,
  KunyinKeyResult,
  KunyinLoginResult,
  KunyinQRCode,
  KunyinQRPoll,
  LocalQQAccount
} from '@common'
import { appDataPath } from '../../core/paths'
import { createLogger } from '../../core/logger'
import { requestRawWithHeaders } from '../../net/request'
import { nativeRequest } from './http'
import {
  envelopeMessage,
  parseLocalAccounts,
  parseRedirectCode,
  parseUserMe,
  pickAuthGroups,
  pickCookie
} from './parse'

const log = createLogger('kunyin-account')

const API_BASE = 'https://c.wwwweb.top'
const GRAPH_BASE = 'https://graph.qq.com'
const LOCAL_ORIGIN = 'https://localhost.ptlogin2.qq.com'
const LOCAL_PORTS = [4301, 4303, 4305, 4307, 4309]
const LOCAL_TIMEOUT = 1500

// QQ 互联（QQ 音乐）的应用参数，与网页版登录面板一致
const QQ_APPID = 100497308
const QQ_CLIENT_APPID = '716027609'
const QQ_DOMAIN_ID = '383'
const QQ_REDIRECT_URI =
  'https://y.qq.com/portal/wx_redirect.html?login_type=1&surl=https%3A%2F%2Fy.qq.com%2F'
const QQ_SCOPE = 'get_user_info,get_app_friends'
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'

const EMPTY_ACCOUNT: KunyinAccount = { loggedIn: false, keys: [] }

interface StoredSession {
  cookie: string
  account: KunyinAccount
}

let session: StoredSession = { cookie: '', account: { ...EMPTY_ACCOUNT } }
let loaded = false
/** 快捷登录进行中时复用同一个 Promise，连点不会打出多条登录请求 */
let quickInFlight: Promise<KunyinLoginResult> | null = null
/** 上次探测成功的本地端口，取 key / 登录时先走它 */
let localPort: number | null = null

// ── 会话持久化 ──

function filePath(): string {
  return appDataPath('kunyin.bin')
}

function ensureLoaded(): void {
  if (loaded) return
  loaded = true
  try {
    const raw = readFileSync(filePath())
    if (raw.length === 0) return
    const text = safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(raw)
      : raw.toString('utf-8')
    const parsed = JSON.parse(text) as Partial<StoredSession>
    const account = parsed.account && typeof parsed.account === 'object' ? parsed.account : null
    session = {
      cookie: typeof parsed.cookie === 'string' ? parsed.cookie : '',
      account: account
        ? { ...EMPTY_ACCOUNT, ...account, keys: Array.isArray(account.keys) ? account.keys : [] }
        : { ...EMPTY_ACCOUNT }
    }
  } catch {
    /* 损坏 / 换机器解不开：当作未登录 */
  }
}

function save(): void {
  try {
    const dir = appDataPath()
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const text = JSON.stringify(session)
    const data = safeStorage.isEncryptionAvailable()
      ? safeStorage.encryptString(text)
      : Buffer.from(text, 'utf-8')
    const path = filePath()
    const tmp = `${path}.tmp`
    writeFileSync(tmp, data)
    renameSync(tmp, path)
  } catch (e) {
    log.warn('保存账号会话失败', e)
  }
}

function setSession(cookie: string, account: KunyinAccount): void {
  session = { cookie, account }
  save()
}

function clearSession(): void {
  session = { cookie: '', account: { ...EMPTY_ACCOUNT } }
  save()
}

// ── 后端请求（Electron net.request：保留 set-cookie、走应用代理） ──

interface BackendResult {
  status: number
  json: unknown
  setCookie: string[]
}

async function backend(
  path: string,
  opts: {
    method?: string
    body?: Record<string, unknown>
    query?: Record<string, string>
    cookie?: string
  } = {}
): Promise<BackendResult> {
  const res = await requestRawWithHeaders(API_BASE + path, {
    method: opts.method ?? 'GET',
    body: opts.body,
    query: opts.query,
    cookie: opts.cookie ?? (session.cookie || undefined),
    timeout: 15000
  })
  let json: unknown = null
  try {
    json = JSON.parse(res.body.toString('utf-8'))
  } catch {
    /* 网关错误页等非 JSON 响应，调用方按 status 兜底 */
  }
  const raw = res.headers['set-cookie']
  return {
    status: res.status,
    json,
    setCookie: Array.isArray(raw) ? raw : raw ? [raw] : []
  }
}

function envelopeCode(json: unknown): number {
  const code = (json as { code?: unknown } | null)?.code
  return typeof code === 'number' ? code : Number(code) || 0
}

/** 拉 /user/me；未登录或会话失效时清掉本地会话。 */
async function fetchMe(): Promise<KunyinAccount> {
  if (!session.cookie) return { ...EMPTY_ACCOUNT, keys: [] }
  const r = await backend('/user/me')
  if (r.status !== 200) throw new Error(envelopeMessage(r.json, r.status))
  const account = parseUserMe(r.json)
  if (!account.loggedIn) {
    clearSession()
    return { ...EMPTY_ACCOUNT, keys: [] }
  }
  setSession(session.cookie, account)
  return account
}

export function getAccount(): KunyinAccount {
  ensureLoaded()
  return session.account
}

export async function refreshAccount(): Promise<KunyinAccount> {
  ensureLoaded()
  return await fetchMe()
}

export async function logout(): Promise<KunyinAccount> {
  ensureLoaded()
  if (session.cookie) {
    try {
      await backend('/user/logout', { method: 'POST' })
    } catch {
      /* 后端不可达也照样退出本地会话 */
    }
  }
  clearSession()
  return getAccount()
}

// ── 本机 QQ 客户端（快捷登录） ──

function localHeaders(): Record<string, string> {
  // 本地服务按 Origin 白名单放行，只认 graph.qq.com
  return { Origin: GRAPH_BASE, Referer: `${GRAPH_BASE}/`, 'User-Agent': UA }
}

interface LocalKey {
  uin: number
  keyIndex: number
  key: string
}

async function localGet(port: number, pathWithQuery: string): Promise<unknown> {
  const res = await nativeRequest(`${LOCAL_ORIGIN}:${port}${pathWithQuery}`, {
    headers: localHeaders(),
    timeout: LOCAL_TIMEOUT,
    insecure: true
  })
  if (res.status !== 200) throw new Error(`本机 QQ 接口返回 HTTP ${res.status}`)
  return JSON.parse(res.body)
}

/** 同时探所有端口，谁先响应就用谁（面板也是这么做的）。 */
async function probePorts<T>(
  task: (port: number) => Promise<T>
): Promise<{ port: number; value: T }> {
  return await new Promise((resolve, reject) => {
    let pending = LOCAL_PORTS.length
    let done = false
    for (const port of LOCAL_PORTS) {
      task(port).then(
        (value) => {
          if (done) return
          done = true
          localPort = port
          resolve({ port, value })
        },
        () => {
          pending -= 1
          if (!done && pending === 0) reject(new Error('未检测到运行中的 QQ'))
        }
      )
    }
  })
}

export async function localAccounts(): Promise<LocalQQAccount[]> {
  try {
    const uuid = randomUUID()
    const { value } = await probePorts((port) =>
      localGet(port, `/quick_login/accounts?req_id=${uuid}&uuid=${uuid}`)
    )
    return parseLocalAccounts(value)
  } catch {
    return []
  }
}

async function fetchClientKey(uin: string, uuid: string): Promise<LocalKey> {
  const query =
    `/quick_login/key?uin=${encodeURIComponent(uin)}` +
    `&open_appid=${QQ_APPID}` +
    `&redirect_url=${encodeURIComponent(`${GRAPH_BASE}/oauth2.0/login_jump`)}` +
    `&appid=${QQ_CLIENT_APPID}&domain_id=${QQ_DOMAIN_ID}` +
    `&req_id=${uuid}&uuid=${uuid}`
  const read = (body: unknown): LocalKey => {
    const b = (body ?? {}) as Record<string, unknown>
    const key = typeof b.key === 'string' ? b.key : ''
    const keyIndex = typeof b.key_index === 'number' ? b.key_index : 0
    if (!key) throw new Error('本机 QQ 未返回登录凭据')
    return { uin: Number(uin), keyIndex, key }
  }
  if (localPort !== null) {
    try {
      return read(await localGet(localPort, query))
    } catch {
      localPort = null
    }
  }
  const { value } = await probePorts((port) => localGet(port, query))
  return read(value)
}

// ── graph.qq.com 新版登录面板 API ──

function graphHeaders(uuid: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'x-connect-uuid': uuid,
    'x-connect-locale': '2052',
    Origin: GRAPH_BASE,
    Referer: `${GRAPH_BASE}/`,
    'User-Agent': UA
  }
}

/**
 * 调一次 /connect/api/v1/*。`__context__` 是服务端下发的不透明状态块：
 * 上一次响应里取出来，塞进下一次请求体，缺了就过不去。
 */
async function graphPost(
  path: string,
  uuid: string,
  body: Record<string, unknown>,
  ctx: { value: string }
): Promise<Record<string, unknown>> {
  if (ctx.value) body.__context__ = ctx.value
  const res = await nativeRequest(`${GRAPH_BASE}/connect/api/v1/${path}`, {
    method: 'POST',
    headers: graphHeaders(uuid),
    body: JSON.stringify(body),
    timeout: 15000
  })
  let json: Record<string, unknown> = {}
  try {
    json = JSON.parse(res.body) as Record<string, unknown>
  } catch {
    throw new Error(`QQ 登录接口返回异常 (HTTP ${res.status})`)
  }
  const code = typeof json.code === 'number' ? json.code : 0
  if (code !== 0) {
    throw new Error(
      typeof json.message === 'string' && json.message ? json.message : `QQ 接口错误 (${code})`
    )
  }
  if (typeof json.__context__ === 'string' && json.__context__) ctx.value = json.__context__
  return json
}

/** 走完快捷登录面板，返回一次性 OAuth code。 */
async function quickLoginCode(uin: string): Promise<string> {
  const uuid = randomUUID()
  const ctx = { value: '' }
  const oauth = {
    appid: QQ_APPID,
    redirect_uri: QQ_REDIRECT_URI,
    scope: QQ_SCOPE,
    response_type: 'code',
    state: 'state'
  }

  // 面板先建一张二维码只为拿初始 __context__（随后丢弃）
  await graphPost('qrcode/create', uuid, { ...oauth }, ctx)

  const loginOnce = async (): Promise<Record<string, unknown>> => {
    const key = await fetchClientKey(uin, uuid)
    const json = await graphPost(
      'quick/login',
      uuid,
      { ...oauth, uin: key.uin, key_index: key.keyIndex, client_key: key.key },
      ctx
    )
    return json
  }
  let login = await loginOnce()
  const statusOf = (j: Record<string, unknown>): string => {
    const data = (j.data ?? {}) as Record<string, unknown>
    return typeof data.status === 'string' ? data.status : ''
  }
  // key 过期时面板会重新取一次 key 再试
  if (statusOf(login) === 'QUICK_LOGIN_STATUS_KEY_EXPIRED') login = await loginOnce()
  switch (statusOf(login)) {
    case 'QUICK_LOGIN_STATUS_SUCCESS':
      break
    case 'QUICK_LOGIN_STATUS_FORCE_SCAN':
      throw new Error('QQ 要求扫码验证，请改用扫码登录')
    case 'QUICK_LOGIN_STATUS_ACCOUNT_ABNORMAL':
      throw new Error('QQ 账号状态异常，请先在手机 QQ 处理')
    default: {
      const data = (login.data ?? {}) as Record<string, unknown>
      const msg =
        typeof data.errorMsg === 'string' && data.errorMsg ? data.errorMsg : '快捷登录失败'
      throw new Error(msg)
    }
  }

  const scope = await graphPost('app/scope', uuid, {}, ctx)
  const { scopes, authGroups } = pickAuthGroups(scope)
  if (scopes.length === 0 || authGroups.length === 0) throw new Error('QQ 授权范围为空')
  const auth = await graphPost('app/authorize', uuid, { scopes, auth_groups: authGroups }, ctx)
  const redirectUri = ((auth.data ?? {}) as Record<string, unknown>).redirectUri
  const code = parseRedirectCode(typeof redirectUri === 'string' ? redirectUri : '')
  if (!code) throw new Error('QQ 未返回登录 code')
  return code
}

export function quickLogin(uin: string): Promise<KunyinLoginResult> {
  if (quickInFlight) return quickInFlight
  quickInFlight = (async (): Promise<KunyinLoginResult> => {
    ensureLoaded()
    try {
      const code = await quickLoginCode(uin)
      const r = await backend('/user/quick/login', { method: 'POST', body: { code }, cookie: '' })
      const okCode = envelopeCode(r.json)
      if (r.status !== 200 || okCode !== 200) {
        return { ok: false, reason: 'failed', message: envelopeMessage(r.json, r.status) }
      }
      const cookie = pickCookie(r.setCookie, 'qq_auth')
      if (!cookie) return { ok: false, reason: 'failed', message: '后端未返回登录会话' }
      setSession(cookie, { ...EMPTY_ACCOUNT })
      const account = await fetchMe()
      if (!account.loggedIn) return { ok: false, reason: 'failed', message: '登录状态校验失败' }
      return { ok: true, account }
    } catch (e) {
      const message = e instanceof Error ? e.message : '快捷登录失败'
      const noQQ = message.includes('未检测到运行中的 QQ')
      log.warn('快捷登录失败', { uin, message })
      return { ok: false, reason: noQQ ? 'no_qq' : 'failed', message }
    } finally {
      quickInFlight = null
    }
  })()
  return quickInFlight
}

// ── 扫码登录（后端代理） ──

export async function qrNew(): Promise<KunyinQRCode> {
  const r = await backend('/user/qr/new', { method: 'POST', cookie: '' })
  const data = ((r.json as { data?: Record<string, unknown> } | null)?.data ?? {}) as Record<
    string,
    unknown
  >
  const qrsig = typeof data.qrsig === 'string' ? data.qrsig : ''
  const image = typeof data.image === 'string' ? data.image : ''
  if (r.status !== 200 || !qrsig || !image) throw new Error(envelopeMessage(r.json, r.status))
  return { qrsig, image }
}

export async function qrPoll(qrsig: string): Promise<KunyinQRPoll> {
  const r = await backend('/user/qr/poll', { query: { qrsig }, cookie: '' })
  const data = ((r.json as { data?: Record<string, unknown> } | null)?.data ?? {}) as Record<
    string,
    unknown
  >
  const status = typeof data.status === 'string' ? data.status : 'error'
  const message = typeof data.message === 'string' ? data.message : undefined
  if (status !== 'done') {
    return { status: status as KunyinQRPoll['status'], message }
  }
  const cookie = pickCookie(r.setCookie, 'qq_auth')
  if (!cookie) return { status: 'error', message: '后端未返回登录会话' }
  setSession(cookie, { ...EMPTY_ACCOUNT })
  try {
    const account = await fetchMe()
    return { status: 'done', account }
  } catch (e) {
    return { status: 'done', message: e instanceof Error ? e.message : undefined }
  }
}

// ── 卡密管理 ──

function keyResult(r: BackendResult): KunyinKeyResult {
  const json = (r.json ?? {}) as Record<string, unknown>
  const message = typeof json.message === 'string' ? json.message : ''
  const code = envelopeCode(r.json)
  if (r.status !== 200 || code !== 200) {
    return { ok: false, message: message || envelopeMessage(r.json, r.status) }
  }
  const data = (json.data ?? {}) as Record<string, unknown>
  return {
    ok: true,
    message: message || '操作成功',
    newKey: typeof data.newKey === 'string' ? data.newKey : undefined,
    expiresAt: typeof data.expiresAt === 'string' ? data.expiresAt : undefined,
    code: typeof data.code === 'string' ? data.code : undefined
  }
}

export async function bindKey(key: string): Promise<KunyinKeyResult> {
  ensureLoaded()
  if (!session.cookie) return { ok: false, message: '请先登录 QQ' }
  return keyResult(await backend('/user/bind', { method: 'POST', body: { key } }))
}

export async function migrateKey(oldKey: string): Promise<KunyinKeyResult> {
  ensureLoaded()
  if (!session.cookie) return { ok: false, message: '请先登录 QQ' }
  return keyResult(await backend('/cdk/migrate', { method: 'POST', body: { oldKey } }))
}

export async function groupCode(key: string): Promise<KunyinKeyResult> {
  ensureLoaded()
  if (!session.cookie) return { ok: false, message: '请先登录 QQ' }
  return keyResult(await backend('/user/code', { method: 'POST', body: { key } }))
}
