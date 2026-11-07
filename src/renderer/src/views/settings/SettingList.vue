<script setup lang="ts">
/** 列表设置（对应 lx-music-desktop 的「列表设置」）。 */
import { storeToRefs } from 'pinia'
import { useSettingsStore } from '../../stores/settings'
import BaseCheckbox from '../../components/BaseCheckbox.vue'
import BaseSelect from '../../components/BaseSelect.vue'

const store = useSettingsStore()
const { settings } = storeToRefs(store)
</script>

<template>
  <dt id="list">列表设置</dt>
  <dd>
    <div class="list-options">
      <BaseCheckbox
        id="setting_list_show_operation_buttons"
        :model-value="settings.list.showOperationButtons"
        label="显示列表操作按钮"
        @update:model-value="store.update({ list: { showOperationButtons: $event as boolean } })"
      />
      <div class="control-row">
        <label for="setting_list_add_position">添加歌曲到列表时的位置</label>
        <BaseSelect
          id="setting_list_add_position"
          :model-value="settings.list.addToPlaylistPosition"
          :list="[
            { id: 'top', label: '顶部' },
            { id: 'bottom', label: '底部' }
          ]"
          @update:model-value="
            store.update({
              list: { addToPlaylistPosition: $event as 'top' | 'bottom' }
            })
          "
        />
      </div>
    </div>
    <p class="tip">
      添加到歌单、我的收藏时插在开头还是末尾。试听列表是播放时自动累积的，始终按播放先后追加。
    </p>
    <p class="tip">歌手页的专辑排列方式与排序方向在该页面内切换，不在这里设置。</p>
  </dd>
</template>

<style scoped>
.list-options {
  display: grid;
  gap: 14px;
  font-size: 13px;
}
.control-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}
.tip {
  margin-top: 10px;
  color: var(--color-font-label);
  font-size: 12px;
}
</style>
