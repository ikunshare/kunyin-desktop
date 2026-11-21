/**
 * 卡密激活管理（对应 Android manager/AuthManager.kt）。
 * 卡密即 authst，经 c.wwwweb.top/app/checkAuth 校验；本地用 safeStorage 加密持久化到 auth.bin。
 * currentAuthst 直接注入自建后端 getUrl（解锁 kg/qq 及加密音质）。
 * 设置页「卡密管理」另经 /cdk/query 只读查询类型、有效期与额度（不计使用次数）。
 */
import { safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import type { AuthState, CdkQueryResult } from '@common'
import { requestJson } from '../net/request'
import { appDataPath } from '../core/paths'
import { parseCdkQuery } from './cdkQuery'

const CHECK_AUTH_URL = 'https://c.wwwweb.top/app/checkAuth'
const CDK_QUERY_URL = 'https://c.wwwweb.top/cdk/query'

const state: AuthState = { authst: '', isValid: false, message: '' }
let loaded = false

function filePath(): string {
  return appDataPath('auth.bin')
}

function loadFromDisk(): string {
  try {
    const raw = readFileSync(filePath())
    if (raw.length === 0) return ''
    if (safeStorage.isEncryptionAvailable()) return safeStorage.decryptString(raw)
    return raw.toString('utf-8')
  } catch {
    return ''
  }
}

function saveToDisk(authst: string): void {
  const path = filePath()
  const dir = appDataPath()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const data =
    authst && safeStorage.isEncryptionAvailable()
      ? safeStorage.encryptString(authst)
      : Buffer.from(authst, 'utf-8')
  const tmp = `${path}.tmp`
  writeFileSync(tmp, data)
  renameSync(tmp, path)
}

function ensureLoaded(): void {
  if (loaded) return
  state.authst = loadFromDisk()
  loaded = true
}

async function callCheckAuth(authst: string): Promise<{ valid: boolean; message: string }> {
  try {
    const resp = await requestJson<{ valid?: boolean; message?: string }>(CHECK_AUTH_URL, {
      method: 'POST',
      body: { authst }
    })
    return { valid: !!resp.valid, message: resp.message ?? '验证失败' }
  } catch {
    return { valid: false, message: '网络错误，请稍后重试' }
  }
}

/** 供 getUrl 注入的当前卡密 */
export function currentAuthst(): string {
  ensureLoaded()
  return state.authst
}

/** 当前激活状态快照 */
export function getAuthState(): AuthState {
  ensureLoaded()
  return { ...state }
}

/** 用户提交卡密：校验通过则加密持久化并更新状态 */
export async function validateAndSave(authst: string): Promise<AuthState> {
  ensureLoaded()
  const trimmed = authst.trim()
  const { valid, message } = await callCheckAuth(trimmed)
  if (valid) {
    saveToDisk(trimmed)
    state.authst = trimmed
  }
  state.isValid = valid
  state.message = message
  return { ...state }
}

/** 启动时若本地有卡密则静默校验一次 */
export async function checkOnStartup(): Promise<void> {
  ensureLoaded()
  if (!state.authst) return
  const { valid, message } = await callCheckAuth(state.authst)
  state.isValid = valid
  state.message = valid ? '' : message
}

/**
 * 查询当前卡密的类型、状态、有效期与额度（POST /cdk/query）。只读：不计使用次数、不消耗额度。
 * 卡密放 body 不放 URL：后端请求日志与 CDN 日志会记完整 query。没有卡密时不发请求。
 */
export async function queryCdkInfo(): Promise<CdkQueryResult> {
  ensureLoaded()
  const key = state.authst
  if (!key) return { ok: false, message: '尚未填写卡密' }
  try {
    const body = await requestJson<unknown>(CDK_QUERY_URL, { method: 'POST', body: { key } })
    return parseCdkQuery(body)
  } catch (e) {
    // 不是 JSON 多半是网关错误页（或后端还没部署这个接口），与断网分开提示
    if (e instanceof SyntaxError) return { ok: false, message: '服务器返回异常，请稍后重试' }
    return { ok: false, message: '网络错误，请稍后重试' }
  }
}

export function clearAuth(): void {
  saveToDisk('')
  state.authst = ''
  state.isValid = false
  state.message = ''
}
