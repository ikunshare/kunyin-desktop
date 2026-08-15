/**
 * 系统媒体集成（对应 Android service/PlaybackService 的键位/通知部分）：
 * - 全局媒体键（globalShortcut：MediaPlayPause/MediaNextTrack/MediaPreviousTrack）
 * - 系统托盘（播放控制 + 显示/退出）
 * - 任务栏缩略图工具栏（Windows ThumbarButton：上一首/播放暂停/下一首）
 * - 开机自启（app.setLoginItemSettings）
 *
 * SMTC 显示与传输控制走渲染层 Web MediaSession（Chromium 自动桥接），此处补媒体键、托盘
 * 与缩略图工具栏。命令经 MEDIA_COMMAND 转发给渲染层 player。
 */
import { app, globalShortcut, ipcMain, Menu, Tray, nativeImage, type BrowserWindow } from 'electron'
import { IpcChannels, type MediaCommand } from '@common'
import { getMainWindow, createMainWindow } from '../../windows/main'
import { appEvent } from '../../core/events'
import trayIconIco from '../../../../resources/icons/icon.ico?asset'
import trayIconPng from '../../../../resources/icons/32x32.png?asset'
import thumbPrev from '../../../../resources/icons/thumb-prev.png?asset'
import thumbPlay from '../../../../resources/icons/thumb-play.png?asset'
import thumbPause from '../../../../resources/icons/thumb-pause.png?asset'
import thumbNext from '../../../../resources/icons/thumb-next.png?asset'

let tray: Tray | null = null
/** 挂了缩略图工具栏的主窗口（播放状态变化时刷新播放/暂停按钮） */
let thumbarWin: BrowserWindow | null = null
/** 最近一次播放状态（窗口重建/重新显示时用来恢复按钮） */
let thumbarPlaying = false

function sendCommand(cmd: MediaCommand): void {
  const win = getMainWindow()
  if (win && !win.isDestroyed()) win.webContents.send(IpcChannels.MEDIA_COMMAND, cmd)
}

/**
 * 任务栏缩略图工具栏（Windows）：上一首 / 播放暂停 / 下一首。
 * 点击经 MEDIA_COMMAND 转发给渲染层 player，与托盘、全局媒体键共用同一入口。
 *
 * 必须在窗口 show 之后调用才稳定生效——Electron 在窗口隐藏/显示后会清掉缩略图按钮
 * （electron#28319），而主窗口是 show:false 创建、等首帧绘制完才显示的。因此这里由
 * main-window-created 挂 show 事件重放，而不是只在创建时挂一次。
 */
function applyThumbar(): void {
  if (process.platform !== 'win32' || !thumbarWin || thumbarWin.isDestroyed()) return
  thumbarWin.setThumbarButtons([
    {
      tooltip: '上一首',
      icon: nativeImage.createFromPath(thumbPrev),
      click: () => sendCommand('prev')
    },
    {
      tooltip: thumbarPlaying ? '暂停' : '播放',
      icon: nativeImage.createFromPath(thumbarPlaying ? thumbPause : thumbPlay),
      click: () => sendCommand('playpause')
    },
    {
      tooltip: '下一首',
      icon: nativeImage.createFromPath(thumbNext),
      click: () => sendCommand('next')
    }
  ])
}

/** 更新播放状态：窗口可见时立刻刷新按钮，否则等下次 show 时重放 */
function setThumbarPlaying(playing: boolean): void {
  thumbarPlaying = playing
  if (thumbarWin && thumbarWin.isVisible()) applyThumbar()
}

function showMainWindow(): void {
  const win = getMainWindow() ?? createMainWindow()
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

function registerGlobalShortcuts(): void {
  // 注册失败（被占用）不阻断启动
  globalShortcut.register('MediaPlayPause', () => sendCommand('playpause'))
  globalShortcut.register('MediaNextTrack', () => sendCommand('next'))
  globalShortcut.register('MediaPreviousTrack', () => sendCommand('prev'))
}

function buildTray(): void {
  if (tray) return
  if (process.platform === 'win32') {
    // ico 含多尺寸，系统按 DPI 自动取合适的一档
    tray = new Tray(trayIconIco)
  } else {
    let image = nativeImage.createFromPath(trayIconPng)
    if (!image.isEmpty()) image = image.resize({ width: 16, height: 16 })
    tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image)
  }
  tray.setToolTip('坤音')

  const menu = Menu.buildFromTemplate([
    { label: '显示主窗口', click: showMainWindow },
    { type: 'separator' },
    { label: '播放/暂停', click: () => sendCommand('playpause') },
    { label: '上一首', click: () => sendCommand('prev') },
    { label: '下一首', click: () => sendCommand('next') },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        app.quit()
      }
    }
  ])
  tray.setContextMenu(menu)
  tray.on('double-click', showMainWindow)
}

/** 根据设置应用开机自启（Android 无此项，桌面新增；默认关闭）。 */
export function applyAutoLaunch(): void {
  // settings 暂无 autoLaunch 字段，预留：默认不开机自启。
  // 后续在 settings.appearance 或新增 system 分类加开关时接这里。
  app.setLoginItemSettings({ openAtLogin: false })
}

export function registerMediaModule(): void {
  registerGlobalShortcuts()
  buildTray()
  applyAutoLaunch()

  // 缩略图图标加载失败会导致按钮不可见，提前在控制台暴露便于排查
  if (process.platform === 'win32') {
    for (const [name, path] of [
      ['prev', thumbPrev],
      ['play', thumbPlay],
      ['pause', thumbPause],
      ['next', thumbNext]
    ] as const) {
      if (nativeImage.createFromPath(path).isEmpty()) {
        console.warn(`[media] 缩略图图标加载失败: ${name} (${path})`)
      }
    }
  }

  // 渲染层推送播放状态 → 刷新缩略图工具栏的播放/暂停按钮
  ipcMain.on(IpcChannels.MEDIA_SET_STATE, (_e, playing: boolean) => {
    setThumbarPlaying(!!playing)
  })

  // 窗口创建后挂缩略图工具栏（Windows 专属；主窗口可能被销毁后重建）
  appEvent.on('main-window-created', (win) => {
    thumbarWin = win
    // 主窗口创建时是隐藏的（等首帧才 show），show 后再挂才能稳定生效；
    // 之后每次隐藏/显示（或任务栏缩略图被系统重建）也重放一遍。
    win.on('show', applyThumbar)
    win.on('closed', () => {
      if (thumbarWin === win) thumbarWin = null
    })
    applyThumbar()
  })

  app.on('will-quit', () => {
    globalShortcut.unregisterAll()
  })
}
