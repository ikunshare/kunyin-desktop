/**
 * 主进程常驻模块注册器（参照 lx-music-desktop 的 registerModules）。
 *
 * 已接入：
 * - devtools：Ctrl+F12 开发者工具（Release 亦可）、窗口级崩溃/白屏日志
 * - media：全局媒体键、托盘、开机自启（SMTC 显示走渲染层 Web MediaSession）
 * - sync：LX Music 同步客户端（Phase 5.2）
 * - backup：备份/导入（Phase 5.3）
 * - updater：自动更新（Phase 5.3）
 * 说明：下载队列走 IPC handler 按需初始化；音频代理走 audio/protocol（app ready 时装）。
 */
import { registerDevToolsModule } from './devtools'
import { registerMediaModule } from './media'
import { registerPlaylistRefresh } from './playlist-refresh'
import { registerShortcuts } from './shortcuts'
import { registerDesktopLyricModule } from './desktop-lyrics/window'
import { registerSyncModule } from './sync'
import { registerBackupHandlers } from './backup'
import { registerUpdaterModule } from './updater'

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
}
