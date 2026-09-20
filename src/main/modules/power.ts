/**
 * 播放期间阻止系统休眠 + 任务栏播放进度（对应 lx-music-desktop 的
 * `player.powerSaveBlocker` 与 `player.isShowTaskProgess`）。
 *
 * 两件事都只靠渲染层推来的播放状态驱动，所以合在一个模块里：
 * - 休眠拦截用 `prevent-app-suspension`（不是 `prevent-display-sleep`）：听歌时屏幕本来就该
 *   能黑掉，要拦的是系统挂起把音频掐断那一档；
 * - 任务栏进度走 `win.setProgressBar`，Windows 显示在任务栏按钮上、macOS 在 dock 图标上。
 *
 * 渲染层的状态是「事件驱动 + 1 秒一次的进度心跳」，暂停后就不再推——所以这里不能等下一条
 * 消息来收尾，暂停/停止时必须自己立刻把拦截和进度条撤掉。
 */
import { app, ipcMain, powerSaveBlocker, type BrowserWindow } from 'electron'
import { IpcChannels } from '@common'
import { appEvent } from '../core/events'
import { createLogger } from '../core/logger'
import { getSettings } from '../store/settings'

const log = createLogger('power')

let mainWindow: BrowserWindow | null = null
let blockerId: number | null = null
let playing = false
/** 最近一次进度（0..1）；设置开关改变时用它立刻重画进度条 */
let progress = 0

function startBlocker(): void {
  if (blockerId !== null && powerSaveBlocker.isStarted(blockerId)) return
  try {
    blockerId = powerSaveBlocker.start('prevent-app-suspension')
    log.info('已阻止系统休眠')
  } catch (e) {
    log.warn('无法阻止系统休眠', e)
    blockerId = null
  }
}

function stopBlocker(): void {
  if (blockerId === null) return
  try {
    if (powerSaveBlocker.isStarted(blockerId)) powerSaveBlocker.stop(blockerId)
  } catch (e) {
    log.warn('取消休眠拦截失败', e)
  }
  blockerId = null
}

function applyProgress(): void {
  const win = mainWindow
  if (!win || win.isDestroyed()) return
  const on = getSettings().player.taskbarProgress
  // -1 = 不显示。进度条只在真正播放时显示，暂停后留着一条静止的条很碍眼。
  win.setProgressBar(on && playing ? Math.max(0, Math.min(1, progress)) : -1)
}

function apply(): void {
  if (playing && getSettings().player.powerSaveBlocker) startBlocker()
  else stopBlocker()
  applyProgress()
}

export function registerPowerModule(): void {
  appEvent.on('main-window-created', (win) => {
    mainWindow = win
    win.on('closed', () => {
      if (mainWindow === win) mainWindow = null
    })
    apply()
  })

  // 与 media 模块监听的是同一个 channel：ipcMain.on 允许多个监听者，各取所需
  ipcMain.on(IpcChannels.MEDIA_SET_STATE, (_e, next: boolean) => {
    playing = !!next
    apply()
  })

  ipcMain.on(IpcChannels.MEDIA_SET_PROGRESS, (_e, percent: number) => {
    progress = Number.isFinite(percent) ? percent : 0
    applyProgress()
  })

  // 设置里关掉开关时要立刻生效，不能等下一次播放状态变化
  appEvent.on('settings-updated', apply)

  // 退出前撤掉拦截。进程结束后系统本来也会回收这条 request，但显式还掉更干净，
  // 也顺带覆盖「窗口关完但进程还在托盘里挂着」那一档。
  app.on('will-quit', stopBlocker)
}
