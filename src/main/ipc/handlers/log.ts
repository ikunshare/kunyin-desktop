/**
 * 日志相关 IPC：接收渲染层日志、暴露日志文件信息与导出入口。
 *
 * LOG_WRITE 走 `ipcMain.on` 而非 `handle`：渲染层每条日志都等一次 invoke 回执会把
 * 播放/歌词这类高频路径拖慢，日志本身也不需要返回值。
 */
import { ipcMain, shell } from 'electron'
import { IpcChannels, type LogEntry } from '@common'
import { handle } from '../helpers'
import {
  dumpRecentLogs,
  getLogFileInfo,
  getRecentLogs,
  writeRendererEntry
} from '../../core/logger'

export function registerLogHandlers(): void {
  const rates = new WeakMap<Electron.WebContents, { second: number; count: number }>()
  ipcMain.on(IpcChannels.LOG_WRITE, (event, entry: LogEntry) => {
    const second = Math.floor(Date.now() / 1000)
    let rate = rates.get(event.sender)
    if (!rate || rate.second !== second) {
      rate = { second, count: 0 }
      rates.set(event.sender, rate)
    }
    if (++rate.count > 100) return
    try {
      writeRendererEntry(entry)
    } catch {
      /* 日志永不因自身失败影响主流程 */
    }
  })

  handle(IpcChannels.LOG_INFO, () => getLogFileInfo())
  handle(IpcChannels.LOG_RECENT, (limit?: number) => getRecentLogs(limit))
  handle(IpcChannels.LOG_DUMP, () => {
    const path = dumpRecentLogs()
    if (path) void shell.showItemInFolder(path)
    return path
  })
  handle(IpcChannels.LOG_OPEN_DIR, async () => {
    await shell.openPath(getLogFileInfo().dir)
  })
}
