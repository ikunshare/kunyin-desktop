/**
 * 主窗口管理。
 */
import { app, BrowserWindow, Menu, shell } from 'electron'
import { join } from 'node:path'
import { is } from '@electron-toolkit/utils'
import { IpcChannels, WINDOW_SIZE_LIST } from '@common'
import icon from '../../../resources/icons/icon.png?asset'
import { appEvent } from '../core/events'
import { getSettings } from '../store/settings'

let mainWindow: BrowserWindow | null = null
let isQuitting = false

app.on('before-quit', () => {
  isQuitting = true
})

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

/** 显示主窗口（幂等）。由渲染层 window:ready 触发，另有创建时的超时兜底。 */
export function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  if (!mainWindow.isVisible()) mainWindow.show()
  mainWindow.focus()
}

export function createMainWindow(): BrowserWindow {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.focus()
    return mainWindow
  }

  const settings = getSettings()
  // 按设置中的窗口尺寸档位创建（对应设置页"窗口尺寸"选项）
  const sizeConf =
    WINDOW_SIZE_LIST.find((i) => i.id === settings.appearance.windowSizeId) ?? WINDOW_SIZE_LIST[3]

  const win = new BrowserWindow({
    width: sizeConf.width,
    height: sizeConf.height,
    resizable: process.platform === 'linux' && settings.behavior.startInFullscreen,
    maximizable: false,
    fullscreenable: true,
    fullscreen: settings.behavior.startInFullscreen,
    show: false,
    autoHideMenuBar: true,
    title: '坤音',
    frame: false,
    // 关闭 Windows 11 DWM 的焦点色边框和外阴影；圆角由渲染层裁切，避免重新带回蓝边。
    roundedCorners: false,
    thickFrame: false,
    hasShadow: false,
    transparent: true,
    backgroundColor: '#00000000',
    // mac 的 Dock 图标由 app bundle 决定；win/linux 窗口图标显式给
    // （Windows 打包后 exe 图标接管，这里主要让 dev 模式任务栏不显示 Electron 默认图标）
    ...(process.platform !== 'darwin' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegrationInWorker: true,
      contextIsolation: false,
      webSecurity: false,
      nodeIntegration: true,
      sandbox: false,
      enableWebSQL: false,
      spellcheck: false, // 禁用拼写检查器
      // 关掉后台节流：窗口最小化/隐藏到托盘后 Chromium 会限制定时器与渲染，
      // 而播放态、进度、SMTC 元数据都由渲染层推送——被节流后系统媒体面板
      // 与桌面歌词会停在旧状态上。音乐播放器必须全程保持后台活跃。
      backgroundThrottling: false
    }
  })

  Menu.setApplicationMenu(null)

  // 不在 ready-to-show 显示：此时首帧只有 #app 的主题背景图（Vue 尚未挂载），
  // 用户会看到背景图一闪而过。改等渲染层 window:ready（挂载 + 真实 UI 完成一帧绘制），
  // 超时兜底防止渲染异常导致窗口永不显示。
  const showFallback = setTimeout(showMainWindow, 8000)
  win.once('show', () => clearTimeout(showFallback))

  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  const notifyFullscreen = (): void => {
    if (!win.isDestroyed()) {
      win.webContents.send(IpcChannels.WINDOW_FULLSCREEN_CHANGED, win.isFullScreen())
    }
  }
  win.on('enter-full-screen', notifyFullscreen)
  win.on('leave-full-screen', notifyFullscreen)

  win.on('close', (event) => {
    if (isQuitting) return
    if (getSettings().behavior.closeToTray) {
      event.preventDefault()
      win.hide()
      return
    }
    // 桌面歌词窗口即使不可见也仍计入 BrowserWindow；只关闭主窗口会导致
    // window-all-closed 永远不触发。Windows/Linux 明确走 app.quit 关闭所有窗口。
    if (process.platform !== 'darwin') {
      event.preventDefault()
      app.quit()
    }
  })

  // HMR：开发期加载 dev server，生产加载打包后的 index.html
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  win.on('closed', () => {
    mainWindow = null
  })

  mainWindow = win
  appEvent.emit('main-window-created', win)
  return win
}
