/**
 * 主进程常驻模块注册器（参照 lx-music-desktop 的 registerModules）。
 *
 * 不在这里的：系统媒体面板（SMTC）走渲染层 Web MediaSession；下载队列由 IPC handler
 * 按需初始化；音频流协议在 app ready 时由 audio/protocol 挂上。
 */
import { registerDevToolsModule } from './devtools'
import { registerMediaModule } from './media'
import { registerPlaylistRefresh } from './playlist-refresh'
import { registerShortcuts } from './shortcuts'
import { registerDesktopLyricModule } from './desktop-lyrics/window'
import { registerSyncModule } from './sync'
import { registerBackupHandlers } from './backup'
import { registerUpdaterModule } from './updater'
import { registerPowerModule } from './power'

export function registerModules(): void {
  // 须在任何窗口创建前：它挂的是 app 级 browser-window-created，晚了会漏掉主窗口
  registerDevToolsModule()
  registerPlaylistRefresh()
  registerMediaModule()
  registerShortcuts()
  registerDesktopLyricModule()
  registerSyncModule()
  registerBackupHandlers()
  registerUpdaterModule()
  registerPowerModule()
}
