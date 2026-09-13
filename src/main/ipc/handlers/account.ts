import { createLogger } from '../../core/logger'
const log = createLogger('login')
/**
 * 平台登录 / 账号 IPC。
 * - wy：扫码（HTTP 轮询）
 * - qq：扫码（MQTT over WS，状态经 ACCOUNT_QQ_QR_EVENT 推送）+ 网页登录（独立登录窗取 cookie）
 * - kg：扫码（thirdsso 车机接口 + HTTP 轮询），另保留手填凭据入口
 * 凭据统一经 credentials.ts safeStorage 持久化并注入 provider。
 */
import {
  IpcChannels,
  type AccountProvider,
  type AccountStatus,
  type KgManualCreds,
  type KgQRCode,
  type KgQRPoll,
  type WyQRCode,
  type WyQRPoll,
  type QQQRCodeInfo,
  type QQQRStatusEvent,
  type QQWebLoginEvent
} from '@common'
import { handle, sendToRenderer } from '../helpers'
import { getProvider } from '../../providers'
import {
  saveCredential,
  clearCredential,
  loggedInKeys,
  onCredentialsChange
} from '../../auth/credentials'
import { wyGetUnikey, wyBuildQRUrl, wyPollStatus } from '../../auth/login/wy'
import { qqCreateQRCode, qqConnectAndListen } from '../../auth/login/qq'
import { qqWebClose, qqWebFinish, qqWebOpen } from '../../auth/login/qqWeb'
import { kgCreateQRCode, kgPollQRCode, kgStopQRCode } from '../../auth/login/kg'
import { kgGenerateDeviceId } from '../../providers/kg/thirdsso'
import * as platformStore from '../../store/platformPlaylists'

const DISPLAY: Record<AccountProvider, string> = {
  qq: 'QQ音乐',
  wy: '网易云音乐',
  kg: '酷狗音乐'
}

// qq 扫码当前的停止函数（同一时刻仅一个二维码会话）
let qqStop: (() => void) | null = null

/**
 * 登录态 + 昵称/头像。昵称优先读平台歌单缓存（Android AccountSection 读的就是
 * platformPlaylistStore.getUserInfo）——列表页刷新时已经拿过，这里不必再打一次接口；
 * 缓存还没有（刚登录、列表页没开过）才现查一次并顺手写进缓存。
 */
async function buildStatus(provider: AccountProvider): Promise<AccountStatus> {
  const loggedIn = loggedInKeys().includes(provider)
  const status: AccountStatus = {
    provider,
    displayName: DISPLAY[provider],
    loggedIn
  }
  if (loggedIn) {
    let info = platformStore.getUserInfo(provider)
    if (!info) {
      info =
        (await getProvider(provider)
          ?.getUserInfo()
          .catch(() => null)) ?? null
      if (info) platformStore.saveUserInfo(provider, info)
    }
    if (info) {
      status.nickname = info.nickname
      status.avatar = info.avatar
    }
  }
  return status
}

export function registerAccountHandlers(): void {
  // 凭据变更 → 广播（渲染层刷新账号列表）
  onCredentialsChange(() => sendToRenderer(IpcChannels.ACCOUNT_CHANGED))

  handle(IpcChannels.ACCOUNT_LIST, async (): Promise<AccountStatus[]> => {
    return Promise.all((['qq', 'wy', 'kg'] as AccountProvider[]).map(buildStatus))
  })

  handle(IpcChannels.ACCOUNT_LOGOUT, (provider: AccountProvider) => {
    // 先清缓存再清凭据：ACCOUNT_CHANGED 广播时账号页重新 list，别再把旧昵称读出来
    platformStore.clearPlatform(provider)
    clearCredential(provider)
  })

  handle(IpcChannels.ACCOUNT_KG_SAVE, (creds: KgManualCreds) => {
    if (!creds.userid || !creds.token) return
    saveCredential('kg', {
      userid: creds.userid,
      token: creds.token,
      mid: creds.mid || undefined,
      dfid: creds.dfid || undefined,
      // thirdsso 接口需要 device_id；手填时补一个并落盘，免得每次启动都换设备
      deviceId: kgGenerateDeviceId()
    })
  })

  // —— kg 扫码（thirdsso）——
  handle(IpcChannels.ACCOUNT_KG_QR_CREATE, async (): Promise<KgQRCode | null> => {
    return kgCreateQRCode()
  })
  handle(IpcChannels.ACCOUNT_KG_QR_POLL, async (ticket: string): Promise<KgQRPoll> => {
    const r = await kgPollQRCode(ticket)
    if (r.status === 'success' && r.credentials) {
      saveCredential('kg', r.credentials as unknown as Record<string, unknown>)
    }
    return { status: r.status }
  })
  handle(IpcChannels.ACCOUNT_KG_QR_STOP, () => {
    kgStopQRCode()
  })

  // —— wy 扫码 ——
  handle(IpcChannels.ACCOUNT_WY_QR_CREATE, async (): Promise<WyQRCode | null> => {
    const unikey = await wyGetUnikey()
    if (!unikey) return null
    return { unikey, url: wyBuildQRUrl(unikey) }
  })
  handle(IpcChannels.ACCOUNT_WY_QR_POLL, async (unikey: string): Promise<WyQRPoll> => {
    const r = await wyPollStatus(unikey)
    if (r.status === 'success' && r.cookie) {
      saveCredential('wy', { cookie: r.cookie })
    }
    return { status: r.status === 'loading' ? 'waiting' : r.status }
  })

  // —— qq 扫码（MQTT over WS）——
  handle(IpcChannels.ACCOUNT_QQ_QR_START, async (): Promise<QQQRCodeInfo | null> => {
    qqStop?.()
    qqStop = null
    let qr: QQQRCodeInfo
    try {
      qr = await qqCreateQRCode()
    } catch (error) {
      log.error('QQ 登录二维码获取失败', error)
      return null
    }
    qqStop = qqConnectAndListen(qr.qrcodeId, (r) => {
      const evt: QQQRStatusEvent = {
        qrcodeId: qr.qrcodeId,
        status: r.status,
        message: r.message
      }
      if (r.status === 'confirmed' && r.credentials) {
        saveCredential('qq', r.credentials as unknown as Record<string, unknown>)
      }
      sendToRenderer(IpcChannels.ACCOUNT_QQ_QR_EVENT, evt)
    })
    return qr
  })
  handle(IpcChannels.ACCOUNT_QQ_QR_STOP, () => {
    qqStop?.()
    qqStop = null
  })

  // —— qq 网页登录（对应 Android LoginWebViewScreen）——
  handle(IpcChannels.ACCOUNT_QQ_WEB_OPEN, async () => {
    await qqWebOpen((r) => {
      if (r.status === 'success') {
        saveCredential('qq', r.credentials as unknown as Record<string, unknown>)
        sendToRenderer(IpcChannels.ACCOUNT_QQ_WEB_EVENT, { status: 'success' } as QQWebLoginEvent)
      } else {
        sendToRenderer(IpcChannels.ACCOUNT_QQ_WEB_EVENT, {
          status: 'closed',
          message: r.message
        } as QQWebLoginEvent)
      }
    })
  })
  handle(IpcChannels.ACCOUNT_QQ_WEB_FINISH, async (): Promise<boolean> => {
    const creds = await qqWebFinish()
    if (!creds) return false
    saveCredential('qq', creds as unknown as Record<string, unknown>)
    return true
  })
  handle(IpcChannels.ACCOUNT_QQ_WEB_CLOSE, () => {
    qqWebClose()
  })
}
