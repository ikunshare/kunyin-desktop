/**
 * 同步会话持久化（对应 Android sync/SyncClientState.kt 的 load/save/clearSession 部分）。
 * clientId + sessionKey 存 userData/data/lx_sync_session.json（明文即可，key 本身是设备会话密钥，
 * 与卡密无关；丢失只会触发一次 CDK 重新激活）。服务器地址/CDK/设备名/模式走 settings.sync。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import type { SyncClientStateStore, SyncSession } from './client'
import { appDataPath } from '../../core/paths'

function filePath(): string {
  return appDataPath('lx_sync_session.json')
}

export function createStateStore(): SyncClientStateStore {
  return {
    load(): SyncSession | null {
      try {
        const raw = readFileSync(filePath(), 'utf-8')
        const o = JSON.parse(raw) as Partial<SyncSession>
        if (!o.clientId || !o.aesKey) return null
        return { clientId: o.clientId, aesKey: o.aesKey, serverName: o.serverName ?? '' }
      } catch {
        return null
      }
    },
    save(s: SyncSession): void {
      const path = filePath()
      const dir = appDataPath()
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      const tmp = `${path}.tmp`
      writeFileSync(tmp, JSON.stringify(s))
      renameSync(tmp, path)
    },
    clearSession(): void {
      try {
        writeFileSync(filePath(), '{}')
      } catch {
        /* noop */
      }
    }
  }
}
