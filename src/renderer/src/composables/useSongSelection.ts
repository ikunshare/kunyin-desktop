import { computed, ref, type ComputedRef, type Ref } from 'vue'
import { getMusicItemKey, type MusicItem } from '@common'

export interface SongSelection {
  /** 已选歌曲的 key 集合 */
  selectedKeys: Ref<Set<string>>
  selectedCount: ComputedRef<number>
  /** 已选歌曲（按列表顺序） */
  selectedItems: ComputedRef<MusicItem[]>
  isSelected: (item: MusicItem) => boolean
  clearSelection: () => void
  /** 绑到 SongRow 的 select 事件（普通 / Ctrl / Shift 单击） */
  onRowSelect: (e: MouseEvent, index: number) => void
}

/**
 * 歌曲列表多选（对齐 LX handleSelectData）：
 * - 普通单击：不选中；若已有选中则清空。播放靠双击、菜单靠右键。
 * - Ctrl/Cmd+单击：切换该曲选中，并把它设为区间锚点。
 * - Shift+单击：以锚点为端点做区间选中（替换现有选择）。
 *
 * 选中态按歌曲 key 记录，列表尾部追加（加载更多）不影响已选；列表整体换掉时由调用方 clearSelection。
 */
export function useSongSelection(list: Ref<MusicItem[]>): SongSelection {
  const selectedKeys = ref<Set<string>>(new Set())
  const anchorIndex = ref(-1)
  const selectedCount = computed(() => selectedKeys.value.size)
  const selectedItems = computed(() =>
    list.value.filter((t) => selectedKeys.value.has(getMusicItemKey(t)))
  )
  function isSelected(item: MusicItem): boolean {
    return selectedKeys.value.has(getMusicItemKey(item))
  }
  function clearSelection(): void {
    selectedKeys.value = new Set()
    anchorIndex.value = -1
  }
  function onRowSelect(e: MouseEvent, index: number): void {
    const items = list.value
    if (e.shiftKey) {
      if (selectedKeys.value.size && anchorIndex.value >= 0) {
        if (anchorIndex.value !== index) {
          const [a, b] = [anchorIndex.value, index].sort((x, y) => x - y)
          const next = new Set<string>()
          for (let i = a; i <= b; i++) next.add(getMusicItemKey(items[i]))
          selectedKeys.value = next
        }
      } else {
        selectedKeys.value = new Set([getMusicItemKey(items[index])])
        anchorIndex.value = index
      }
    } else if (e.ctrlKey || e.metaKey) {
      anchorIndex.value = index
      const key = getMusicItemKey(items[index])
      const next = new Set(selectedKeys.value)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      selectedKeys.value = next
    } else if (selectedKeys.value.size) {
      clearSelection()
    }
  }
  return { selectedKeys, selectedCount, selectedItems, isSelected, clearSelection, onRowSelect }
}
