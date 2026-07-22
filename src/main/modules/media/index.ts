/**
 * 系统媒体集成（对应 Android service/PlaybackService 的键位/通知部分）：
 * - 全局媒体键（globalShortcut：MediaPlayPause/MediaNextTrack/MediaPreviousTrack）
 * - 系统托盘（播放控制 + 显示/退出）
 * - 开机自启（app.setLoginItemSettings）
 *
 * SMTC 显示与传输控制走渲染层 Web MediaSession（Chromium 自动桥接），此处只补媒体键与托盘。
 * 命令经 MEDIA_COMMAND 转发给渲染层 player。
 */
import { app, globalShortcut, Menu, Tray, nativeImage } from 'electron'
import { join } from 'node:path'
import { IpcChannels, type MediaCommand } from '@common'
import { getMainWindow, createMainWindow } from '../../windows/main'

let tray: Tray | null = null

function sendCommand(cmd: MediaCommand): void {
  const win = getMainWindow()
  if (win && !win.isDestroyed()) win.webContents.send(IpcChannels.MEDIA_COMMAND, cmd)
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
  const iconPath = join(__dirname, '../../resources/icon.png')
  let image = nativeImage.createFromPath(iconPath)
  if (!image.isEmpty()) image = image.resize({ width: 16, height: 16 })
  tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image)
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

  app.on('will-quit', () => {
    globalShortcut.unregisterAll()
  })
}
