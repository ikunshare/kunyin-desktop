/**
 * 网易云扫码登录（1:1 移植 Android platform/wy/WyQRLogin.kt）。
 * getUnikey → 二维码 URL music.163.com/login?codekey= → 轮询 client/login：
 * 801 等待 / 802 已扫 / 803 成功（从 Set-Cookie 取 MUSIC_U）/ 800 过期。
 */
import { eapiPost, eapiPostRaw, extractMusicU } from '../../crypto/netease'

export type WyQRStatus = 'loading' | 'waiting' | 'scanned' | 'success' | 'expired' | 'error'

export interface WyPollResult {
  status: WyQRStatus
  /** success 时的 cookie，形如 `MUSIC_U=xxx` */
  cookie?: string
}

/** 申请 unikey（二维码 key）。失败返回 null。 */
export async function wyGetUnikey(): Promise<string | null> {
  try {
    const json = await eapiPost<{ code?: number; unikey?: string }>('/api/login/qrcode/unikey', {
      type: 3
    })
    if (json?.code !== 200) return null
    return json.unikey ?? null
  } catch {
    return null
  }
}

export function wyBuildQRUrl(unikey: string): string {
  return `https://music.163.com/login?codekey=${unikey}`
}

/** 轮询二维码状态。 */
export async function wyPollStatus(unikey: string): Promise<WyPollResult> {
  try {
    const { json, setCookie } = await eapiPostRaw<{ code?: number }>(
      '/api/login/qrcode/client/login',
      {
        type: 3,
        key: unikey
      }
    )
    switch (json?.code) {
      case 801:
        return { status: 'waiting' }
      case 802:
        return { status: 'scanned' }
      case 803: {
        const musicU = extractMusicU(setCookie.join('; '))
        if (musicU) return { status: 'success', cookie: `MUSIC_U=${musicU}` }
        return { status: 'error' }
      }
      case 800:
        return { status: 'expired' }
      default:
        return { status: 'error' }
    }
  } catch {
    return { status: 'error' }
  }
}
