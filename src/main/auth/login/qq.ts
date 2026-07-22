/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * QQ 音乐扫码登录（1:1 移植 Android platform/qq/MobileQRLogin.kt）。
 * MQTT over WebSocket：CreateQRCode 拿二维码 → wss 握手 CONNECT → CONNACK 后 SUBSCRIBE
 * management.qrcode_login/{id} → PUBLISH 收 scanned/cookies 事件 → Login 换正式凭据。
 * WebSocket 走 `ws` 包（可设 Origin/Referer 头，主进程直连）。
 */
import WebSocket from 'ws'
import { requestJson } from '../../net/request'
import {
  buildConnectPacket,
  buildSubscribePacket,
  parsePacket,
  CONNACK,
  SUBACK,
  PUBLISH
} from './mqtt'

const MUSICU_URL = 'https://u6.y.qq.com/cgi-bin/musicu.fcg'
const WS_URL = 'wss://mu.y.qq.com:443/ws/handshake'
const WS_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'

export interface QQCredentials {
  authst: string
  uin: string
  refreshToken?: string
  refreshKey?: string
  accessToken?: string
  openid?: string
  expiredAt?: number
}

export type QQQRStatus = 'waiting' | 'scanned' | 'confirmed' | 'timeout' | 'refused' | 'error'

export interface QQPollResult {
  status: QQQRStatus
  message: string
  credentials?: QQCredentials
}

/** 向 musicu.fcg 发无签名请求，返回指定 reqKey 下的 data。 */
async function apiCall(
  module: string,
  method: string,
  param: Record<string, unknown>,
  commonOverrides?: Record<string, string>
): Promise<any> {
  const reqKey = `${module}.${method}`
  const comm: Record<string, unknown> = {
    ct: '11',
    cv: '13020508',
    v: '13020508',
    tmeAppID: 'qqmusic',
    format: 'json',
    inCharset: 'utf-8',
    outCharset: 'utf-8',
    ...commonOverrides
  }
  const body = {
    comm,
    [reqKey]: { module, method, param }
  }
  const respJson = await requestJson<any>(MUSICU_URL, {
    method: 'POST',
    headers: {
      'User-Agent': 'QQMusic/2104583050',
      'Content-Type': 'application/json',
      Referer: 'https://y.qq.com/'
    },
    body: JSON.stringify(body)
  })
  const reqData = respJson?.[reqKey]
  if (!reqData) throw new Error(`响应缺少 ${reqKey}`)
  const code = Number(reqData.code ?? 0)
  if (code !== 0) throw new Error(`API错误: ${code}`)
  return reqData.data ?? reqData
}

export interface QQQRCode {
  /** 二维码图片（data URL，直接给 <img>） */
  image: string
  qrcodeId: string
}

/** 申请二维码，返回图片 data URL + qrcodeID。 */
export async function qqCreateQRCode(): Promise<QQQRCode> {
  const resp = await apiCall('music.login.LoginServer', 'CreateQRCode', {
    tmeAppID: 'qqmusic',
    ct: 11,
    cv: 13020508
  })
  const qrcodeId = String(resp.qrcodeID)
  const qrRaw = String(resp.qrcode)
  // 服务端可能返回带前缀的 data URL，也可能是裸 base64
  const image = qrRaw.includes(',') ? qrRaw : `data:image/png;base64,${qrRaw}`
  return { image, qrcodeId }
}

function parseCredentialResponse(data: any): QQCredentials {
  return {
    authst: String(data.musickey ?? ''),
    uin: String(data.str_musicid ?? data.musicid ?? ''),
    refreshToken: String(data.refresh_token ?? ''),
    refreshKey: String(data.refresh_key ?? ''),
    accessToken: String(data.access_token ?? ''),
    openid: String(data.openid ?? ''),
    expiredAt: Number(data.expired_at ?? 0)
  }
}

async function mobileLogin(
  musicid: number,
  qrCodeID: string,
  token: string
): Promise<QQCredentials> {
  const resp = await apiCall(
    'music.login.LoginServer',
    'Login',
    { musicid, qrCodeID, token },
    { tmeLoginType: '6' }
  )
  return parseCredentialResponse(resp)
}

/** loginType：Q_H_L→2(QQ)，W_X_→1(微信)，其余 0。 */
function loginTypeOf(authst: string): number {
  if (authst.startsWith('Q_H_L')) return 2
  if (authst.startsWith('W_X_')) return 1
  return 0
}

/** 刷新 QQ 凭据，失败返回 null。 */
export async function qqRefreshCredential(creds: QQCredentials): Promise<QQCredentials | null> {
  try {
    const lt = loginTypeOf(creds.authst)
    const param: Record<string, unknown> =
      lt === 1
        ? {
            code: '',
            openid: creds.openid ?? '',
            refresh_token: creds.refreshToken ?? '',
            str_musicid: creds.uin,
            musickey: creds.authst,
            unionid: '',
            refresh_key: creds.refreshKey ?? '',
            expired_in: creds.expiredAt ?? 0,
            loginMode: 1
          }
        : {
            openid: creds.openid ?? '',
            access_token: creds.accessToken ?? '',
            refresh_token: creds.refreshToken ?? '',
            musickey: creds.authst,
            musicid: Number(creds.uin) || 0,
            refresh_key: creds.refreshKey ?? '',
            expired_in: creds.expiredAt ?? 0,
            loginMode: 2
          }
    const resp = await apiCall('music.login.LoginServer', 'Login', param, {
      tmeLoginType: String(lt)
    })
    return parseCredentialResponse(resp)
  } catch {
    return null
  }
}

/**
 * 连接 WS 并监听扫码事件。返回一个 stop 函数用于取消（关窗时调用）。
 * onStatus 收到 confirmed/refused/timeout 后连接自动结束。
 */
export function qqConnectAndListen(
  qrcodeId: string,
  onStatus: (r: QQPollResult) => void
): () => void {
  const clientId = `${Date.now()}${Math.floor(1000 + Math.random() * 9000)}`
  let done = false
  let activeWs: WebSocket | null = null

  const headers = {
    Origin: 'https://y.qq.com',
    Referer: 'https://y.qq.com/',
    'User-Agent': WS_UA
  }

  const connect = (path = ''): WebSocket => {
    const ws = new WebSocket(`${WS_URL}${path}`, { headers })
    ws.binaryType = 'nodebuffer'

    ws.on('open', () => {
      const connectPacket = buildConnectPacket({
        clientId,
        authMethod: 'pass',
        userProperties: [
          ['tmeAppID', 'qqmusic'],
          ['business', 'management'],
          ['hashTag', qrcodeId],
          ['clientTag', 'management.user'],
          ['userID', qrcodeId]
        ]
      })
      ws.send(connectPacket)
    })

    ws.on('message', (data: Buffer) => {
      if (done) return
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer)
      const msg = parsePacket(buf)
      if (!msg) return

      if (msg.serverReference != null) {
        // 服务端重定向：连新节点，关旧连接
        const newWs = connect(`/${msg.serverReference}`)
        activeWs = newWs
        try {
          ws.close(1000, 'redirect')
        } catch {
          /* noop */
        }
        return
      }

      if (msg.type === CONNACK) {
        const subPacket = buildSubscribePacket({
          packetId: 1,
          topic: `management.qrcode_login/${qrcodeId}`,
          userProperties: [
            ['authorization', 'tmelogin'],
            ['pubsub', 'unicast']
          ]
        })
        ws.send(subPacket)
        return
      }

      if (msg.type === SUBACK) {
        onStatus({ status: 'waiting', message: '等待扫码' })
        return
      }

      if (msg.type === PUBLISH && msg.payload != null) {
        void handleMqttEvent(msg.userProperties, msg.payload, qrcodeId, (result) => {
          if (
            result.status === 'confirmed' ||
            result.status === 'refused' ||
            result.status === 'timeout'
          ) {
            done = true
          }
          onStatus(result)
        })
      }
    })

    ws.on('error', (err: Error) => {
      if (!done && activeWs === ws) {
        onStatus({ status: 'error', message: `连接失败: ${err.message ?? ''}` })
      }
    })

    return ws
  }

  activeWs = connect()

  return () => {
    done = true
    try {
      activeWs?.close(1000, 'stop')
    } catch {
      /* noop */
    }
  }
}

async function handleMqttEvent(
  userProps: Record<string, string>,
  payload: Buffer,
  qrcodeId: string,
  onStatus: (r: QQPollResult) => void
): Promise<void> {
  const eventType = userProps['type'] ?? ''
  switch (eventType) {
    case 'scanned':
      onStatus({ status: 'scanned', message: '已扫码，请确认' })
      break
    case 'cookies':
      try {
        const json = JSON.parse(payload.toString('utf-8'))
        const cookies = json?.cookies
        const uin = String(cookies?.qqmusic_uin?.value ?? cookies?.qqmusic_uin ?? '')
        const key = String(cookies?.qqmusic_key?.value ?? cookies?.qqmusic_key ?? '')
        if (uin && key) {
          const credentials = await mobileLogin(Number(uin) || 0, qrcodeId, key)
          onStatus({ status: 'confirmed', message: '登录成功', credentials })
        } else {
          onStatus({ status: 'error', message: '登录数据不完整' })
        }
      } catch (e) {
        onStatus({ status: 'error', message: `登录失败: ${(e as Error).message}` })
      }
      break
    case 'canceled':
      onStatus({ status: 'refused', message: '已取消登录' })
      break
    case 'timeout':
      onStatus({ status: 'timeout', message: '二维码已过期' })
      break
    case 'loginFailed':
      onStatus({ status: 'error', message: '登录失败' })
      break
    default:
      break
  }
}
