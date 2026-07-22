/**
 * 下载 IPC —— 分发到 modules/download/manager。
 * 队列变更由 manager 的 onDownloadChange 回调广播 DOWNLOAD_CHANGED，渲染层重拉。
 */
import { IpcChannels, type AddDownloadInput, type DownloadTask } from '@common'
import { handle, sendToRenderer } from '../helpers'
import * as download from '../../modules/download/manager'

let wired = false

export function registerDownloadHandlers(): void {
  download.loadTasks()
  download.verifyCompletedFiles()

  if (!wired) {
    download.onDownloadChange(() => sendToRenderer(IpcChannels.DOWNLOAD_CHANGED))
    wired = true
  }

  handle(IpcChannels.DOWNLOAD_ADD, (input: AddDownloadInput) => download.addTask(input))
  handle(IpcChannels.DOWNLOAD_LIST, (): DownloadTask[] => download.listTasks())
  handle(IpcChannels.DOWNLOAD_PAUSE, (taskKey: string) => download.pauseTask(taskKey))
  handle(IpcChannels.DOWNLOAD_RESUME, (taskKey: string) => download.resumeTask(taskKey))
  handle(IpcChannels.DOWNLOAD_RETRY, (taskKey: string) => download.retryTask(taskKey))
  handle(IpcChannels.DOWNLOAD_REMOVE, (taskKey: string, deleteFile?: boolean) =>
    download.removeTask(taskKey, deleteFile)
  )
  handle(IpcChannels.DOWNLOAD_CLEAR_COMPLETED, () => download.clearCompleted())
}
