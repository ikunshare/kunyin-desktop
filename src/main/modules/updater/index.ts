/**
 * 自动更新（electron-updater，generic provider 见 electron-builder.yml）。
 * 启动静默检查；发现新版本经 UPDATER_EVENT 通知渲染层；由用户触发下载/安装。
 * 开发环境（未打包）自动跳过。
 */
import { app } from 'electron'
import electronUpdater from 'electron-updater'
import { IpcChannels, type UpdaterEvent } from '@common'
import { handle, sendToRenderer } from '../../ipc/helpers'

const { autoUpdater } = electronUpdater

let wired = false

function emit(evt: UpdaterEvent): void {
  sendToRenderer(IpcChannels.UPDATER_EVENT, evt)
}

function wireEvents(): void {
  if (wired) return
  wired = true
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => emit({ type: 'checking' }))
  autoUpdater.on('update-available', (info) =>
    emit({ type: 'available', version: info.version, notes: normalizeNotes(info.releaseNotes) })
  )
  autoUpdater.on('update-not-available', () => emit({ type: 'not-available' }))
  autoUpdater.on('download-progress', (p) => emit({ type: 'progress', percent: p.percent }))
  autoUpdater.on('update-downloaded', (info) => emit({ type: 'downloaded', version: info.version }))
  autoUpdater.on('error', (err) => emit({ type: 'error', message: err.message }))
}

function normalizeNotes(notes: string | { note: string | null }[] | null | undefined): string {
  if (!notes) return ''
  if (typeof notes === 'string') return notes
  return notes.map((n) => n.note ?? '').join('\n')
}

export function registerUpdaterModule(): void {
  handle(IpcChannels.UPDATER_CHECK, async () => {
    if (!app.isPackaged) {
      emit({ type: 'not-available' })
      return
    }
    wireEvents()
    try {
      await autoUpdater.checkForUpdates()
    } catch (e) {
      emit({ type: 'error', message: (e as Error).message })
    }
  })

  handle(IpcChannels.UPDATER_DOWNLOAD, async () => {
    if (!app.isPackaged) return
    wireEvents()
    try {
      await autoUpdater.downloadUpdate()
    } catch (e) {
      emit({ type: 'error', message: (e as Error).message })
    }
  })

  handle(IpcChannels.UPDATER_INSTALL, () => {
    if (!app.isPackaged) return
    autoUpdater.quitAndInstall()
  })

  // 启动静默检查（仅打包环境，不阻塞、不弹窗，仅在有更新时通过事件通知）
  if (app.isPackaged) {
    wireEvents()
    autoUpdater.checkForUpdates().catch(() => {
      /* 网络错误静默忽略 */
    })
  }
}
