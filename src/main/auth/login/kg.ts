/**
 * 酷狗扫码登录（1:1 移植 Android `KgThirdsso` 的 QR 部分 + `KgQRLoginScreen` 的流程）。
 *
 * 流程：sdk/auth + device/activation 注册匿名设备 → user/qrcode/get 拿二维码 URL 与 ticket
 * → 每 2s 轮询 user/qrcode/auth，用户在 App 确认后返回真正的 userid/token。
 *
 * 二维码只是一串 URL，图片由渲染层用 qrcode 生成（与 wy 一致）。
 * ticket 与 deviceId 必须整个会话保持不变，故把会话状态存在这里而非每次重建。
 */
import {
  kgAnonymousCreds,
  kgGenerateDeviceId,
  kgRequest,
  kgStr,
  type KgCreds
} from '../../providers/kg/thirdsso'

export interface KgQRCodeInfo {
  /** 二维码内容（渲染层据此画图） */
  url: string
  ticket: string
}

export type KgQRStatus = 'waiting' | 'success' | 'expired' | 'error'

export interface KgPollResult {
  status: KgQRStatus
  /** success 时的完整凭据（含 userid/token/deviceId） */
  credentials?: KgCreds
}

/** 当前二维码会话（同一时刻仅一个） */
let session: { creds: KgCreds; ticket: string; attempts: number } | null = null

/** 轮询上限：2s 一次 × 90 次 ≈ 3 分钟（对齐 Android 的 attempts < 90） */
const MAX_ATTEMPTS = 90

/** 注册匿名设备。失败不阻断——部分设备 ID 已激活过，二维码接口照样可用。 */
async function registerDevice(creds: KgCreds): Promise<boolean> {
  const auth = await kgRequest('sdk/auth', creds, {
    userid: 'anonymous',
    token: 'password'
  })
  if (auth?.error_code !== 0 || auth.data?.status !== 0) return false

  const activation = await kgRequest('device/activation', creds, {
    userid: 'anonymous',
    token: 'password'
  })
  if (activation?.error_code !== 0) return false
  return activation.data?.activation_date != null
}

/** 申请二维码。失败返回 null。 */
export async function kgCreateQRCode(): Promise<KgQRCodeInfo | null> {
  const creds = kgAnonymousCreds(kgGenerateDeviceId())
  await registerDevice(creds)

  const resp = await kgRequest(
    'user/qrcode/get',
    creds,
    { userid: 'anonymous', token: 'password' },
    { url_code: '1001' }
  )
  if (resp?.error_code !== 0) return null
  const url = kgStr(resp.data?.qrcode)
  const ticket = kgStr(resp.data?.ticket)
  if (!url || !ticket) return null

  session = { creds, ticket, attempts: 0 }
  return { url, ticket }
}

/**
 * 轮询二维码状态。
 *
 * 服务端在「未扫码」「已扫未确认」两种情况下都只回非 0 的 error_code，分不出来，
 * 故统一报 waiting（与 Android 一致），只在超过重试上限时报 expired。
 */
export async function kgPollQRCode(ticket: string): Promise<KgPollResult> {
  if (!session || session.ticket !== ticket) return { status: 'error' }
  if (++session.attempts > MAX_ATTEMPTS) {
    session = null
    return { status: 'expired' }
  }

  const resp = await kgRequest(
    'user/qrcode/auth',
    session.creds,
    { userid: 'anonymous', token: 'password', ticket },
    { url_code: '1002' }
  )
  if (resp?.error_code !== 0) return { status: 'waiting' }

  const userid = kgStr(resp.data?.userid)
  const token = kgStr(resp.data?.token)
  if (!userid || !token) return { status: 'waiting' }

  const credentials: KgCreds = { ...session.creds, userid, token }
  session = null
  return { status: 'success', credentials }
}

/** 关闭登录窗时清掉会话 */
export function kgStopQRCode(): void {
  session = null
}
