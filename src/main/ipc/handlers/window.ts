import { ipcMain } from 'electron'
import { IpcChannels } from '@common'
import { handle } from '../helpers'
import { getMainWindow, showMainWindow } from '../../windows/main'

export function registerWindowHandlers(): void {
  handle(IpcChannels.WINDOW_MINIMIZE, () => getMainWindow()?.minimize())
  handle(IpcChannels.WINDOW_CLOSE, () => getMainWindow()?.close())
  handle(IpcChannels.WINDOW_FULLSCREEN, (enabled?: boolean) => {
    const win = getMainWindow()
    if (!win) return false
    if (enabled === undefined) return win.isFullScreen()

    // Linux 与 lx-music-desktop 一样，进入全屏前临时允许调整大小，退出后再锁定。
    if (process.platform === 'linux' && enabled) win.setResizable(true)
    win.setFullScreen(enabled)
    if (process.platform === 'linux' && !enabled) win.setResizable(false)
    // Windows 上 enter/leave-full-screen 事件并非所有窗口组合都稳定触发，主动同步一次。
    win.webContents.send(IpcChannels.WINDOW_FULLSCREEN_CHANGED, enabled)
    return enabled
  })
  // 设置页窗口尺寸档位：setBounds 仅改宽高，不改变窗口位置（同 lx-music-desktop）。
  // 窗口固定大小（resizable: false），程序改尺寸需临时放开再锁回，兼容 macOS。
  handle(IpcChannels.WINDOW_SET_SIZE, (width: number, height: number) => {
    const win = getMainWindow()
    if (!win || win.isFullScreen()) return
    win.setResizable(true)
    win.setBounds({ width, height })
    win.setResizable(false)
  })
  // 渲染层 UI 首帧绘制完成后上报，此时显示窗口（避免启动闪过裸背景图）
  ipcMain.on(IpcChannels.WINDOW_READY, () => showMainWindow())
}
