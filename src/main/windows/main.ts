/**
 * 主窗口管理。
 */
import { BrowserWindow, Menu, shell } from 'electron'
import path, { join } from 'node:path'
import { is } from '@electron-toolkit/utils'
import icon from '../../../resources/icons/icon.png?asset'
import { appEvent } from '../core/events'

let mainWindow: BrowserWindow | null = null

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

export function createMainWindow(): BrowserWindow {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.focus()
    return mainWindow
  }

  const win = new BrowserWindow({
    width: 1120,
    height: 720,
    minWidth: 940,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    title: '坤音',
    frame: false,
    backgroundColor: '#1b1b1f',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      webSecurity: false
    },
    icon: path.join(__dirname, 'resources/icons/icon.png')
  })

  Menu.setApplicationMenu(null)

  win.on('ready-to-show', () => win.show())

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
