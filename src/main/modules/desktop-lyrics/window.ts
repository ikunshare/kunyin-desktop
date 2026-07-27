/**
 * 桌面歌词悬浮窗（对应 Android manager/FloatingLyricsManager + ui/FloatingLyricsView）。
 *
 * 独立无边框/透明/置顶 BrowserWindow，复用歌词渲染栈。桌面无 overlay 授权门槛（省 canDrawOverlays）。
 * - 锁定态 setIgnoreMouseEvents(true, forward) 实现点击穿透（对应 Android FLAG_NOT_TOUCHABLE）。
 * - 位置持久化到 settings.lyrics.desktopX/Y（见 settings 扩展）。
 * - 主窗口经 DESKTOP_LYRIC_PUSH 推状态，此处转发 DESKTOP_LYRIC_STATE 给歌词窗。
 */
import { app, BrowserWindow, ipcMain, screen } from 'electron'
import { join } from 'node:path'
import { is } from '@electron-toolkit/utils'
import { IpcChannels, type DesktopLyricState } from '@common'
import { getSettings, updateSettings } from '../../store/settings'

let lyricWindow: BrowserWindow | null = null
/** 最近一次状态，新窗口打开时立即回灌 */
let lastState: DesktopLyricState | null = null

const WIN_WIDTH = 640
const WIN_HEIGHT = 160

function createLyricWindow(): BrowserWindow {
  if (lyricWindow && !lyricWindow.isDestroyed()) return lyricWindow

  const { workAreaSize } = screen.getPrimaryDisplay()
  const s = getSettings().lyrics
  const x = s.desktopX >= 0 ? s.desktopX : Math.round((workAreaSize.width - WIN_WIDTH) / 2)
  const y = s.desktopY >= 0 ? s.desktopY : workAreaSize.height - WIN_HEIGHT - 80

  const win = new BrowserWindow({
    width: WIN_WIDTH,
    height: WIN_HEIGHT,
    x,
    y,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    focusable: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })
  win.setAlwaysOnTop(true, 'screen-saver')

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/desktop-lyrics.html`)
  } else {
    win.loadFile(join(__dirname, '../renderer/desktop-lyrics.html'))
  }

  win.on('ready-to-show', () => {
    win.show()
    if (lastState) win.webContents.send(IpcChannels.DESKTOP_LYRIC_STATE, lastState)
  })

  // 拖动后保存位置
  win.on('moved', () => {
    const [nx, ny] = win.getPosition()
    updateSettings({ lyrics: { desktopX: nx, desktopY: ny } })
  })

  win.on('closed', () => {
    lyricWindow = null
  })

  lyricWindow = win
  return win
}

export function showDesktopLyric(): void {
  createLyricWindow()
}

export function hideDesktopLyric(): void {
  if (lyricWindow && !lyricWindow.isDestroyed()) lyricWindow.close()
  lyricWindow = null
}

export function toggleDesktopLyric(enabled: boolean): void {
  if (enabled) showDesktopLyric()
  else hideDesktopLyric()
}

/** 注册 IPC + 按设置初始状态。app ready 后调用。 */
export function registerDesktopLyricModule(): void {
  ipcMain.handle(IpcChannels.DESKTOP_LYRIC_TOGGLE, (_e, enabled: boolean) => {
    toggleDesktopLyric(enabled)
    updateSettings({ lyrics: { desktopEnabled: enabled } })
  })

  // 主窗口推状态 → 缓存 + 转发歌词窗
  ipcMain.on(IpcChannels.DESKTOP_LYRIC_PUSH, (_e, state: DesktopLyricState) => {
    lastState = state
    if (lyricWindow && !lyricWindow.isDestroyed()) {
      lyricWindow.webContents.send(IpcChannels.DESKTOP_LYRIC_STATE, state)
    }
  })

  // 歌词窗设置锁定（点击穿透）
  ipcMain.on(IpcChannels.DESKTOP_LYRIC_SET_LOCK, (e, locked: boolean) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    win?.setIgnoreMouseEvents(locked, { forward: true })
  })

  // 启动时按设置决定是否显示
  if (getSettings().lyrics.desktopEnabled) {
    app.whenReady().then(() => showDesktopLyric())
  }
}
