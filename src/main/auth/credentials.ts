/**
 * 平台登录凭据管理（对应 Android manager/CredentialManager.kt）。
 * 按 provider key（qq/wy/kg/kw）存各平台 cookie/凭据，safeStorage 加密持久化到
 * userData/credentials.bin（单文件 JSON），启动时与登录后注入 `getProvider(src).credentials`。
 */
import { safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { getProvider } from '../providers'
import type { ProviderCredentials } from '../providers/base'
import { appDataPath } from '../core/paths'

export type CredProviderKey = 'qq' | 'wy' | 'kg' | 'kw'
const KEYS: CredProviderKey[] = ['qq', 'wy', 'kg', 'kw']

/** 内存态：providerKey → 凭据 JSON 对象 */
const store = new Map<CredProviderKey, ProviderCredentials>()
let loaded = false

type ChangeCb = () => void
const listeners = new Set<ChangeCb>()

export function onCredentialsChange(cb: ChangeCb): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}
function emitChange(): void {
  for (const cb of listeners) cb()
}

function filePath(): string {
  return appDataPath('credentials.bin')
}

function loadFromDisk(): Record<string, ProviderCredentials> {
  try {
    const raw = readFileSync(filePath())
    if (raw.length === 0) return {}
    const text = safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(raw)
      : raw.toString('utf-8')
    return JSON.parse(text) as Record<string, ProviderCredentials>
  } catch {
    return {}
  }
}

function saveToDisk(): void {
  const path = filePath()
  const dir = appDataPath()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const obj: Record<string, ProviderCredentials> = {}
  for (const [k, v] of store) obj[k] = v
  const text = JSON.stringify(obj)
  const data = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(text)
    : Buffer.from(text, 'utf-8')
  const tmp = `${path}.tmp`
  writeFileSync(tmp, data)
  renameSync(tmp, path)
}

function ensureLoaded(): void {
  if (loaded) return
  const obj = loadFromDisk()
  for (const k of KEYS) {
    if (obj[k]) store.set(k, obj[k])
  }
  loaded = true
}

/** 把内存态注入到对应 provider（启动、登录、登出后调用）。对应 applyToProviders。 */
function applyToProvider(key: CredProviderKey): void {
  const p = getProvider(key)
  if (p) p.credentials = store.get(key) ?? null
}

/** 启动时载入并注入所有 provider（在 registerIpc 后、创建窗口前调用）。 */
export function initCredentials(): void {
  ensureLoaded()
  for (const k of KEYS) applyToProvider(k)
}

/** 保存某平台凭据（登录成功时调用），持久化并注入 provider。 */
export function saveCredential(key: CredProviderKey, creds: ProviderCredentials): void {
  ensureLoaded()
  store.set(key, creds)
  saveToDisk()
  applyToProvider(key)
  emitChange()
}

/** 清除某平台凭据（登出）。 */
export function clearCredential(key: CredProviderKey): void {
  ensureLoaded()
  store.delete(key)
  saveToDisk()
  applyToProvider(key)
  emitChange()
}

/** 读取某平台当前凭据（null 表示未登录）。 */
export function getCredential(key: CredProviderKey): ProviderCredentials | null {
  ensureLoaded()
  return store.get(key) ?? null
}

/** 已登录的平台 key 列表。 */
export function loggedInKeys(): CredProviderKey[] {
  ensureLoaded()
  return KEYS.filter((k) => store.has(k))
}
