/**
 * 主窗口管理。
 */
import { BrowserWindow, Menu, shell } from 'electron'
import { join } from 'node:path'
import { is } from '@electron-toolkit/utils'
import { WINDOW_SIZE_LIST } from '@common'
import icon from '../../../resources/icons/icon.png?asset'
import { appEvent } from '../core/events'
import { getSettings } from '../store/settings'

let mainWindow: BrowserWindow | null = null

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

/** 显示主窗口（幂等）。由渲染层 window:ready 触发，另有创建时的超时兜底。 */
export function showMainWindow(): void {
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
    mainWindow.show()
  }
}

export function createMainWindow(): BrowserWindow {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.focus()
    return mainWindow
  }

  // 按设置中的窗口尺寸档位创建（对应设置页"窗口尺寸"选项）
  const sizeConf =
    WINDOW_SIZE_LIST.find((i) => i.id === getSettings().appearance.windowSizeId) ??
    WINDOW_SIZE_LIST[3]

  const win = new BrowserWindow({
    width: sizeConf.width,
    height: sizeConf.height,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    autoHideMenuBar: true,
    title: '坤音',
    frame: false,
    backgroundColor: '#ffffff',
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
      spellcheck: false // 禁用拼写检查器
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
