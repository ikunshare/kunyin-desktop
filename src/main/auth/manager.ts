/**
 * 卡密激活管理（对应 Android manager/AuthManager.kt）。
 * 卡密即 authst，经 c.wwwweb.top/app/checkAuth 校验；本地用 safeStorage 加密持久化到 auth.bin。
 * currentAuthst 直接注入自建后端 getUrl（解锁 kg/qq 及加密音质）。
 */
import { safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import type { AuthState } from '@common'
import { requestJson } from '../net/request'
import { appDataPath } from '../core/paths'

const CHECK_AUTH_URL = 'https://c.wwwweb.top/app/checkAuth'

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

/** 清除卡密 */
export function clearAuth(): void {
  saveToDisk('')
  state.authst = ''
  state.isValid = false
  state.message = ''
}
