/** Window-scoped release diagnostics; toolkit F12 handling is not installed. */
import { app, BrowserWindow, type WebContents } from 'electron'
import { is } from '@electron-toolkit/utils'
import { isDevToolsCombo } from '@common/devtoolsShortcut'
import { IpcChannels } from '@common'
import { createLogger } from '../core/logger'
import { getSettings } from '../store/settings'
import { handle } from '../ipc/helpers'
import { getMainWindow } from '../windows/main'

const log = createLogger('devtools')

/** 开/关指定 webContents 的 DevTools（detach 模式）。 */
export function toggleDevTools(wc: WebContents | null | undefined): void {
  if (!wc || wc.isDestroyed()) return
  try {
    if (wc.isDevToolsOpened()) {
      wc.closeDevTools()
      log.info('已关闭开发者工具')
    } else {
      wc.openDevTools({ mode: 'detach' })
      log.info('已打开开发者工具')
    }
  } catch (e) {
    log.error('开发者工具切换失败', e)
  }
}

const attached = new WeakSet<BrowserWindow>()
function attach(win: BrowserWindow): void {
  if (attached.has(win)) return
  attached.add(win)
  win.webContents.on('before-input-event', (event, input) => {
    if (!is.dev && (input.control || input.meta) && input.key.toLowerCase() === 'r')
      event.preventDefault()
    const combo = isDevToolsCombo(input, process.platform === 'darwin')
    const bareDev =
      is.dev &&
      input.type === 'keyDown' &&
      !input.isAutoRepeat &&
      input.code === 'F12' &&
      !input.control &&
      !input.meta &&
      !input.alt &&
      !input.shift
    if (!(combo && getSettings().developer.devToolsShortcut) && !bareDev) return
    event.preventDefault()
    toggleDevTools(win.webContents)
  })
  // 渲染进程崩溃/被杀在 Release 下表现为「窗口白屏」，没有日志就完全无从下手
  win.webContents.on('render-process-gone', (_e, details) => {
    log.error('渲染进程异常退出', undefined, {
      reason: details.reason,
      exitCode: details.exitCode,
      url: win.webContents.getURL()
    })
  })
  win.webContents.on('unresponsive', () =>
    log.warn('窗口无响应', { url: win.webContents.getURL() })
  )
  win.webContents.on('responsive', () => log.info('窗口恢复响应'))
  win.webContents.on('preload-error', (_e, preloadPath, error) => {
    log.error('preload 脚本加载失败', error, { preloadPath })
  })
  win.webContents.on('did-fail-load', (_e, errorCode, errorDescription, validatedURL) => {
    // -3 是 ABORTED（多为主动导航打断），不值得当错误报
    if (errorCode === -3) return
    log.error('页面加载失败', undefined, { errorCode, errorDescription, validatedURL })
  })
}

export function registerDevToolsModule(): void {
  app.on('browser-window-created', (_e, win) => attach(win))
  // 本模块在 createMainWindow 之前注册，但以防被调整顺序，已存在的窗口也补挂
  for (const win of BrowserWindow.getAllWindows()) attach(win)

  handle(IpcChannels.DEVTOOLS_TOGGLE, () => {
    const win = BrowserWindow.getFocusedWindow() ?? getMainWindow()
    toggleDevTools(win?.webContents)
  })
}
