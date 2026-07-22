/**
 * WebView 登录（对应 Android ui/screens/settings/LoginWebViewScreen.kt）。
 * 用独立 BrowserWindow 加载平台登录页；用户登录后从该 partition 的 cookies 抽取凭据。
 * 支持 wy（MUSIC_U）与 qq（qm_keyst + uin）。
 */
import { BrowserWindow, session } from 'electron'
import type { ProviderCredentials } from '../../providers/base'
import type { QQCredentials } from './qq'
import path from 'node:path'

export type WebViewProvider = 'qq' | 'wy'

const CONFIG: Record<WebViewProvider, { url: string; title: string; cookieHost: string }> = {
  qq: { url: 'https://y.qq.com', title: 'QQ音乐登录', cookieHost: 'https://y.qq.com' },
  wy: { url: 'https://music.163.com', title: '网易云登录', cookieHost: 'https://music.163.com' }
}

const WV_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

const activeWindows = new Map<WebViewProvider, BrowserWindow>()

/**
 * 打开登录窗口。用户点“完成登录”按钮由渲染层触发（这里直接监听窗口关闭前抓 cookie），
 * 但为对齐 Android“完成登录”交互，窗口关闭时统一尝试抽取凭据并回调。
 */
export function openWebViewLogin(
  provider: WebViewProvider,
  onDone: (creds: ProviderCredentials | null) => void
): void {
  const cfg = CONFIG[provider]
  // 已有窗口则聚焦
  const exist = activeWindows.get(provider)
  if (exist && !exist.isDestroyed()) {
    exist.focus()
    return
  }

  const partition = `persist:login-${provider}`
  const ses = session.fromPartition(partition)
  ses.setUserAgent(WV_UA)

  const win = new BrowserWindow({
    width: 480,
    height: 720,
    title: cfg.title,
    autoHideMenuBar: true,
    webPreferences: {
      partition,
      nodeIntegration: false,
      contextIsolation: true
    },
    icon: path.join(__dirname, 'resources/icons/icon.png')
  })
  activeWindows.set(provider, win)

  let settled = false
  const finish = async (): Promise<void> => {
    if (settled) return
    settled = true
    try {
      const cookies = await ses.cookies.get({ url: cfg.cookieHost })
      const cookieMap: Record<string, string> = {}
      for (const c of cookies) cookieMap[c.name] = c.value
      onDone(extractCredentials(provider, cookieMap))
    } catch {
      onDone(null)
    }
  }

  win.on('closed', () => {
    activeWindows.delete(provider)
    void finish()
  })

  void win.loadURL(cfg.url)
}

function extractCredentials(
  provider: WebViewProvider,
  c: Record<string, string>
): ProviderCredentials | null {
  if (provider === 'wy') {
    const musicU = c['MUSIC_U']
    return musicU ? ({ cookie: `MUSIC_U=${musicU}` } as ProviderCredentials) : null
  }
  // qq：uin 优先 wxuin，去掉前导 o；authst = qm_keyst
  const uinRaw = c['wxuin'] ?? c['uin']
  const uin = uinRaw ? uinRaw.replace(/^o/, '') : null
  const authst = c['qm_keyst']
  if (uin && authst) {
    const creds: QQCredentials = {
      authst,
      uin,
      refreshToken: c['psrf_qqrefresh_token'] ?? '',
      accessToken: c['psrf_qqaccess_token'] ?? '',
      openid: c['psrf_qqopenid'] ?? ''
    }
    return creds as unknown as ProviderCredentials
  }
  return null
}
