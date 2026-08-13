/**
 * 类型安全的 IPC handler 封装与主动推送。
 *
 * `handle` 从 listener 的形参推断参数类型，保持与 preload 侧调用一致；
 * IPC 传入的原始参数在此统一转发。
 */
import { BrowserWindow, ipcMain } from 'electron'
import { getMainWindow } from '../windows/main'

export function handle<A extends unknown[], R>(
  channel: string,
  listener: (...args: A) => R | Promise<R>
): void {
  ipcMain.handle(channel, (_event, ...args) => listener(...(args as A)))
}

/** 主动推送事件到渲染层（主窗口） */
export function sendToRenderer(channel: string, ...args: unknown[]): void {
  const win = getMainWindow()
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args)
}

/** 广播给全部渲染窗口（设置等跨窗口共享状态使用）。 */
export function sendToAllRenderers(channel: string, ...args: unknown[]): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, ...args)
  }
}
