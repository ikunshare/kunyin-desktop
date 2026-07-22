import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { DownloadTask, MusicItem } from '@common'

/**
 * 下载队列状态。数据在主进程；此 store 缓存任务列表，随 DOWNLOAD_CHANGED 广播刷新。
 */
export const useDownloadStore = defineStore('download', () => {
  const tasks = ref<DownloadTask[]>([])

  async function refresh(): Promise<void> {
    tasks.value = await window.api.download.list()
  }

  async function add(item: MusicItem, qualityId?: string): Promise<void> {
    // contextBridge 无法克隆 Pinia 响应式 Proxy，过 IPC 前转普通对象
    const plain = JSON.parse(JSON.stringify(item)) as MusicItem
    await window.api.download.add({ item: plain, qualityId })
  }

  async function pause(taskKey: string): Promise<void> {
    await window.api.download.pause(taskKey)
  }
  async function resume(taskKey: string): Promise<void> {
    await window.api.download.resume(taskKey)
  }
  async function retry(taskKey: string): Promise<void> {
    await window.api.download.retry(taskKey)
  }
  async function remove(taskKey: string, deleteFile = false): Promise<void> {
    await window.api.download.remove(taskKey, deleteFile)
  }
  async function clearCompleted(): Promise<void> {
    await window.api.download.clearCompleted()
  }

  function subscribe(): () => void {
    return window.api.download.onChange(() => void refresh())
  }

  return { tasks, refresh, add, pause, resume, retry, remove, clearCompleted, subscribe }
})
