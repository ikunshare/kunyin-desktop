/**
 * LX 同步模块装配 + IPC（对应 Android sync/SyncManager.kt）。
 * 服务器地址/CDK/设备名/模式/自动连接读 settings.sync；会话密钥走 state store。
 */
import { IpcChannels, type SyncStatusSnapshot } from '@common'
import { handle, sendToRenderer } from '../../ipc/helpers'
import { getSettings } from '../../store/settings'
import { SyncClient, type SyncStatus } from './client'
import { SyncListBridge } from './listBridge'
import { createStateStore } from './state'

let client: SyncClient | null = null
let bridge: SyncListBridge | null = null
const stateStore = createStateStore()

function snapshot(): SyncStatusSnapshot {
  const status = (client?.status ?? 'idle') as SyncStatus
  return {
    status,
    error: client?.lastError ?? null,
    serverName: stateStore.load()?.serverName ?? ''
  }
}

function ensureClient(): SyncClient {
  if (client) return client
  bridge = new SyncListBridge(() => getSettings().sync.syncMode)
  client = new SyncClient(stateStore, bridge)
  client.onStatus(() => sendToRenderer(IpcChannels.SYNC_STATUS_CHANGED, snapshot()))
  return client
}

function doConnect(): void {
  const s = getSettings().sync
  if (!s.serverUrl.trim() || !s.cdk.trim()) return
  ensureClient().connect(s.serverUrl, s.cdk, s.deviceName || 'KunYin Desktop')
}

export function registerSyncModule(): void {
  handle(IpcChannels.SYNC_STATUS, () => snapshot())
  handle(IpcChannels.SYNC_CONNECT, () => {
    doConnect()
  })
  handle(IpcChannels.SYNC_DISCONNECT, () => {
    client?.disconnect()
  })
  handle(IpcChannels.SYNC_RESET, () => {
    client?.disconnect()
    stateStore.clearSession()
    sendToRenderer(IpcChannels.SYNC_STATUS_CHANGED, snapshot())
  })

  // 启动自动连接
  const s = getSettings().sync
  if (s.enable && s.autoConnect && s.serverUrl.trim() && s.cdk.trim()) {
    doConnect()
  }
}
