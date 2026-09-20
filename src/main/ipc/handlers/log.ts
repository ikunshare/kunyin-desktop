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
  createLogger,
  dumpRecentLogs,
  getLogFileInfo,
  getRecentLogs,
  writeRendererEntry
} from '../../core/logger'
import { netStats } from '../../net/request'
import { audioNetStats } from '../../audio/protocol'

const netLog = createLogger('net')

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
    // 导出前把网络栈现状记一条：接口变慢多半是某个 host 的并发闸在堆积
    // （queued 一路涨 = 上游卡住，后面的请求都在排队），事后看日志文件就能分辨。
    const stats = netStats()
    if (stats.length) netLog.info('网络栈在飞/排队', { hosts: stats })
    // 取流走的是另一条路（audio/protocol.ts 直接 net.fetch），单独记一条：
    // 「放久了每首歌都超时」的现场特征是这里堆着一批 bytes=0 的僵尸条目。
    netLog.info('取流在飞', audioNetStats())
    const path = dumpRecentLogs()
    if (path) void shell.showItemInFolder(path)
    return path
  })
  handle(IpcChannels.LOG_OPEN_DIR, async () => {
    await shell.openPath(getLogFileInfo().dir)
  })
}
