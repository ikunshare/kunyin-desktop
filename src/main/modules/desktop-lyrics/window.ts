/**
 * 桌面歌词悬浮窗。
 *
 * 窗口行为参照 lx-music-desktop 的 winLyric：透明无边框、锁定穿透、可缩放、
 * 置顶刷新、任务栏切换、位置尺寸持久化与屏幕边界限制；歌词渲染继续使用坤音的
 * music-lyric-player 动画栈。
 */
import { BrowserWindow, ipcMain, screen, type Rectangle } from 'electron'
import { join } from 'node:path'
import { is } from '@electron-toolkit/utils'
import { IpcChannels, type AppSettings, type DesktopLyricState } from '@common'
import { getSettings, updateSettings } from '../../store/settings'
import { getMainWindow } from '../../windows/main'
import { appEvent } from '../../core/events'
import { sendToAllRenderers } from '../../ipc/helpers'

let lyricWindow: BrowserWindow | null = null
/** 最近一次状态，新窗口打开时立即回灌 */
let lastState: DesktopLyricState | null = null
let saveBoundsTimer: ReturnType<typeof setTimeout> | null = null
let alwaysOnTopTimer: ReturnType<typeof setInterval> | null = null

const DEFAULT_WIDTH = 640
const DEFAULT_HEIGHT = 180
const MIN_WIDTH = 320
const MIN_HEIGHT = 112

function normalizeSize(value: number, fallback: number, min: number): number {
  return Math.max(min, Number.isFinite(value) ? Math.round(value) : fallback)
}

function keepInDisplay(bounds: Rectangle): Rectangle {
  const display = screen.getDisplayMatching(bounds)
  const area = display.workArea
  const width = Math.min(Math.max(bounds.width, MIN_WIDTH), area.width)
  const height = Math.min(Math.max(bounds.height, MIN_HEIGHT), area.height)
  return {
    width,
    height,
    x: Math.min(Math.max(bounds.x, area.x), area.x + area.width - width),
    y: Math.min(Math.max(bounds.y, area.y), area.y + area.height - height)
  }
}

function initialBounds(settings: AppSettings): Rectangle {
  const s = settings.lyrics
  const width = normalizeSize(s.desktopWidth, DEFAULT_WIDTH, MIN_WIDTH)
  const height = normalizeSize(s.desktopHeight, DEFAULT_HEIGHT, MIN_HEIGHT)
  const area = screen.getPrimaryDisplay().workArea
  // 兼容早期以 -1/-1 表示“未设置”的配置；其他负坐标仍可用于左侧副屏。
  const hasStoredPosition =
    s.desktopX != null && s.desktopY != null && !(s.desktopX === -1 && s.desktopY === -1)
  const bounds: Rectangle = {
    width,
    height,
    x: hasStoredPosition ? s.desktopX! : Math.round(area.x + (area.width - width) / 2),
    y: hasStoredPosition ? s.desktopY! : area.y + area.height - height - 80
  }
  return s.desktopLockScreen ? keepInDisplay(bounds) : bounds
}

function clearAlwaysOnTopLoop(): void {
  if (!alwaysOnTopTimer) return
  clearInterval(alwaysOnTopTimer)
  alwaysOnTopTimer = null
}

function applyAlwaysOnTop(settings: AppSettings): void {
  clearAlwaysOnTopLoop()
  const win = lyricWindow
  if (!win || win.isDestroyed()) return
  const { desktopAlwaysOnTop, desktopAlwaysOnTopLoop } = settings.lyrics
  win.setAlwaysOnTop(desktopAlwaysOnTop, 'screen-saver')
  if (!desktopAlwaysOnTop || !desktopAlwaysOnTopLoop) return
  alwaysOnTopTimer = setInterval(() => {
    if (!lyricWindow || lyricWindow.isDestroyed()) {
      clearAlwaysOnTopLoop()
      return
    }
    lyricWindow.setAlwaysOnTop(true, 'screen-saver')
  }, 500)
}

function persistBounds(): void {
  const win = lyricWindow
  if (!win || win.isDestroyed()) return
  if (saveBoundsTimer) clearTimeout(saveBoundsTimer)
  saveBoundsTimer = setTimeout(() => {
    if (!lyricWindow || lyricWindow.isDestroyed()) return
    const bounds = lyricWindow.getBounds()
    updateSettings({
      lyrics: {
        desktopX: bounds.x,
        desktopY: bounds.y,
        desktopWidth: bounds.width,
        desktopHeight: bounds.height
      }
    })
  }, 350)
}

function applyWindowBehavior(settings: AppSettings): void {
  const win = lyricWindow
  if (!win || win.isDestroyed()) return
  const s = settings.lyrics

  win.setResizable(!s.desktopLocked)
  win.setIgnoreMouseEvents(s.desktopLocked, { forward: true })
  win.setSkipTaskbar(!s.desktopShowTaskbar)
  applyAlwaysOnTop(settings)

  const current = win.getBounds()
  let target: Rectangle =
    s.desktopX == null || s.desktopY == null
      ? initialBounds(settings)
      : {
          x: s.desktopX,
          y: s.desktopY,
          width: normalizeSize(s.desktopWidth, current.width, MIN_WIDTH),
          height: normalizeSize(s.desktopHeight, current.height, MIN_HEIGHT)
        }
  if (s.desktopLockScreen) target = keepInDisplay(target)
  if (
    current.x !== target.x ||
    current.y !== target.y ||
    current.width !== target.width ||
    current.height !== target.height
  ) {
    win.setBounds(target)
  }
}

function isMainWindowFullscreen(): boolean {
  const win = getMainWindow()
  return !!win && !win.isDestroyed() && win.isFullScreen()
}

function shouldHideForFullscreen(settings: AppSettings): boolean {
  return settings.lyrics.desktopFullscreenHide && isMainWindowFullscreen()
}

function createLyricWindow(): BrowserWindow {
  if (lyricWindow && !lyricWindow.isDestroyed()) return lyricWindow

  const settings = getSettings()
  const s = settings.lyrics
  const bounds = initialBounds(settings)
  const win = new BrowserWindow({
    ...bounds,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    useContentSize: true,
    frame: false,
    transparent: true,
    resizable: !s.desktopLocked,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    roundedCorners: false,
    skipTaskbar: !s.desktopShowTaskbar,
    alwaysOnTop: s.desktopAlwaysOnTop,
    hasShadow: false,
    focusable: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      backgroundThrottling: false
    }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/desktop-lyrics.html`)
  } else {
    void win.loadFile(join(__dirname, '../renderer/desktop-lyrics.html'))
  }

  win.once('ready-to-show', () => {
    applyWindowBehavior(getSettings())
    if (!shouldHideForFullscreen(getSettings())) win.showInactive()
    if (lastState) win.webContents.send(IpcChannels.DESKTOP_LYRIC_STATE, lastState)
  })

  win.on('move', persistBounds)
  win.on('resize', persistBounds)
  win.on('closed', () => {
    if (saveBoundsTimer) clearTimeout(saveBoundsTimer)
    saveBoundsTimer = null
    clearAlwaysOnTopLoop()
    lyricWindow = null
  })

  lyricWindow = win
  return win
}

export function showDesktopLyric(): void {
  const win = createLyricWindow()
  if (win.isVisible()) return
  if (win.isMinimized()) win.restore()
  win.showInactive()
}

export function hideDesktopLyric(): void {
  if (lyricWindow && !lyricWindow.isDestroyed()) lyricWindow.close()
  lyricWindow = null
  clearAlwaysOnTopLoop()
}

function syncDesktopLyricWindow(settings = getSettings()): void {
  if (!settings.lyrics.desktopEnabled) {
    hideDesktopLyric()
    return
  }
  if (shouldHideForFullscreen(settings)) {
    lyricWindow?.hide()
    return
  }
  showDesktopLyric()
  applyWindowBehavior(settings)
}

function commitLyricSettings(patch: Partial<AppSettings['lyrics']>): AppSettings {
  const next = updateSettings({ lyrics: patch })
  sendToAllRenderers(IpcChannels.SETTINGS_CHANGED, next)
  appEvent.emit('settings-updated', next)
  return next
}

export function toggleDesktopLyric(enabled: boolean): void {
  commitLyricSettings({ desktopEnabled: enabled })
}

/** 注册 IPC + 按设置同步窗口状态。app ready 后调用。 */
export function registerDesktopLyricModule(): void {
  ipcMain.handle(IpcChannels.DESKTOP_LYRIC_TOGGLE, (_e, enabled: boolean) => {
    toggleDesktopLyric(enabled)
  })

  // 主窗口推状态 → 缓存 + 转发歌词窗
  ipcMain.on(IpcChannels.DESKTOP_LYRIC_PUSH, (_e, state: DesktopLyricState) => {
    lastState = state
    if (lyricWindow && !lyricWindow.isDestroyed()) {
      lyricWindow.webContents.send(IpcChannels.DESKTOP_LYRIC_STATE, state)
    }
  })

  // 保留独立锁定通道兼容旧歌词窗；新工具栏也会直接更新 settings。
  ipcMain.on(IpcChannels.DESKTOP_LYRIC_SET_LOCK, (_e, locked: boolean) => {
    commitLyricSettings({ desktopLocked: locked })
  })

  appEvent.on('settings-updated', syncDesktopLyricWindow)
  appEvent.on('main-window-created', (win) => {
    const sync = (): void => syncDesktopLyricWindow()
    win.on('enter-full-screen', sync)
    win.on('leave-full-screen', sync)
    win.on('enter-html-full-screen', sync)
    win.on('leave-html-full-screen', sync)
    win.on('closed', hideDesktopLyric)
  })
  appEvent.on('app-inited', () => syncDesktopLyricWindow())
}
