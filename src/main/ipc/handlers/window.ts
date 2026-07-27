import { ipcMain } from 'electron'
import { IpcChannels } from '@common'
import { handle } from '../helpers'
import { getMainWindow, showMainWindow } from '../../windows/main'

export function registerWindowHandlers(): void {
  handle(IpcChannels.WINDOW_MINIMIZE, () => getMainWindow()?.minimize())
  handle(IpcChannels.WINDOW_CLOSE, () => getMainWindow()?.close())
  // 设置页窗口尺寸档位：setBounds 仅改宽高，不改变窗口位置（同 lx-music-desktop）。
  // 窗口固定大小（resizable: false），程序改尺寸需临时放开再锁回，兼容 macOS。
  handle(IpcChannels.WINDOW_SET_SIZE, (width: number, height: number) => {
    const win = getMainWindow()
    if (!win) return
    win.setResizable(true)
    win.setBounds({ width, height })
    win.setResizable(false)
  })
  // 渲染层 UI 首帧绘制完成后上报，此时显示窗口（避免启动闪过裸背景图）
  ipcMain.on(IpcChannels.WINDOW_READY, () => showMainWindow())
}
