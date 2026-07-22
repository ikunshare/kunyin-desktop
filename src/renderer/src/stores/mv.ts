import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { MusicItem } from '@common'

/** 当前打开的 MV（null=未打开）。MvPlayer 组件订阅它显示 <video> 模态。 */
export const useMvStore = defineStore('mv', () => {
  const current = ref<MusicItem | null>(null)

  function open(item: MusicItem): void {
    current.value = item
  }
  function close(): void {
    current.value = null
  }
  return { current, open, close }
})
