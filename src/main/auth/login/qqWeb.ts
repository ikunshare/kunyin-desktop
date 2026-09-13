/**
 * QQ 音乐网页登录（对应 Android ui/screens/settings/LoginWebViewScreen.kt 的 qq 分支）。
 *
 * 开一个独立 partition 的 BrowserWindow 加载 y.qq.com，用户在页面里用 QQ / 微信登录，之后
 * 点「完成登录」——从该 session 的 cookie 里取 uin / qm_keyst / psrf_* 组成凭据，字段与
 * Android 的 extractCredentials 一致。桌面上关窗也是很自然的「我登录完了」，故关窗时自动再提取一次。
 *
 * 独立 partition 的原因：主 session 是 net.fetch 的默认上下文，若让 y.qq.com 的浏览器 cookie
 * 混进去，所有走 musics.fcg / musicu.fcg 的音源请求都会悄悄带上它们，行为不可控。
 * 用 persist 前缀是对齐 Android WebView 的 CookieManager（跨次启动保留网页登录态）。
 */
import { BrowserWindow, session, type Cookie, type Session } from 'electron'
import { getMainWindow } from '../../windows/main'
import { mirrorProxy } from '../../net/proxy'
import type { QQCredentials } from './qq'

const PARTITION = 'persist:web-login'
const START_URL = 'https://y.qq.com'
/** 与 Android WebView 同款桌面 Chrome UA（Electron 默认 UA 带 Electron 字样，部分页面会走降级逻辑） */
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

/** 登录窗结果：success 附凭据（由调用方落盘）；closed = 窗口关了但没拿到登录态 */
export type QQWebLoginResult =
  { status: 'success'; credentials: QQCredentials } | { status: 'closed'; message: string }

let win: BrowserWindow | null = null
let onResult: ((r: QQWebLoginResult) => void) | null = null
/** 页面最后停留的地址（Android 取 wv.url 对应的 cookie；窗口销毁后读不到，只能提前记） */
let lastUrl = START_URL
/** 已由 finish/close 处理过，关窗回调不必再提取 */
let settled = false

function loginSession(): Session {
  return session.fromPartition(PARTITION)
}

/** 按名字取第一个匹配（对应 parseCookieValue 的 firstOrNull） */
function cookieValue(cookies: Cookie[], name: string): string | undefined {
  return cookies.find((c) => c.name === name)?.value
}

/**
 * 把登录窗 session 里的 cookie 提炼成凭据（1:1 对应 extractCredentials 的 "qq" 分支）：
 * uin 取 wxuin（微信登录）或 uin 并去掉 `o` 前缀；authst 取 qm_keyst；psrf_* 是续期要用的令牌。
 * 先按页面最后停留的地址取，取不到再按站点根地址兜底一次。
 */
async function extractCredentials(): Promise<QQCredentials | null> {
  const ses = loginSession()
  for (const url of new Set([lastUrl, START_URL])) {
    const cookies = await ses.cookies.get({ url }).catch(() => [] as Cookie[])
    const rawUin = cookieValue(cookies, 'wxuin') ?? cookieValue(cookies, 'uin')
    const uin = rawUin?.startsWith('o') ? rawUin.slice(1) : rawUin
    const authst = cookieValue(cookies, 'qm_keyst')
    if (!uin || !authst) continue
    return {
      authst,
      uin,
      refreshToken: cookieValue(cookies, 'psrf_qqrefresh_token') ?? '',
      accessToken: cookieValue(cookies, 'psrf_qqaccess_token') ?? '',
      openid: cookieValue(cookies, 'psrf_qqopenid') ?? '',
      refreshKey: '',
      expiredAt: 0
    }
  }
  return null
}

function destroyWindow(): void {
  if (win && !win.isDestroyed()) win.close()
  win = null
}

/**
 * 打开登录窗；已开着就聚焦。用户手动关窗时自动提取一次凭据并回调结果。
 */
export async function qqWebOpen(handler: (r: QQWebLoginResult) => void): Promise<void> {
  onResult = handler
  if (win && !win.isDestroyed()) {
    win.focus()
    return
  }
  settled = false
  lastUrl = START_URL
  const ses = loginSession()
  ses.setUserAgent(UA)
  await mirrorProxy(ses).catch(() => {})

  const parent = getMainWindow()
  const w = new BrowserWindow({
    width: 1000,
    height: 720,
    title: 'QQ音乐登录',
    autoHideMenuBar: true,
    ...(parent && !parent.isDestroyed() ? { parent } : {}),
    webPreferences: {
      partition: PARTITION,
      // 加载的是第三方远程页面：不给任何 Node 能力
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  win = w
  w.webContents.on('did-navigate', (_e, url) => {
    lastUrl = url
  })
  w.on('closed', () => {
    if (win === w) win = null
    if (settled) return
    settled = true
    void extractCredentials().then((creds) => {
      onResult?.(
        creds
          ? { status: 'success', credentials: creds }
          : { status: 'closed', message: '未在网页中检测到登录态' }
      )
    })
  })
  void w.loadURL(START_URL)
}

/**
 * 「完成登录」：立即提取。成功则关窗并返回凭据；没检测到登录态就保留窗口让用户继续。
 */
export async function qqWebFinish(): Promise<QQCredentials | null> {
  const creds = await extractCredentials()
  if (!creds) return null
  settled = true
  destroyWindow()
  return creds
}

/** 放弃网页登录（关闭登录弹窗时调用）。 */
export function qqWebClose(): void {
  settled = true
  onResult = null
  destroyWindow()
}
