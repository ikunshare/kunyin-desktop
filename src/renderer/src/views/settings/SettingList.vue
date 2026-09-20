<script setup lang="ts">
/** 列表设置（对应 lx-music-desktop 的「列表设置」）。 */
import { storeToRefs } from 'pinia'
import { useSettingsStore } from '../../stores/settings'
import BaseCheckbox from '../../components/BaseCheckbox.vue'

const store = useSettingsStore()
const { settings } = storeToRefs(store)
</script>

<template>
  <dt id="list">列表设置</dt>
  <dd>
    <div>
      <BaseCheckbox
        id="setting_list_show_operation_buttons"
        :model-value="settings.list.showOperationButtons"
        label="显示列表操作按钮"
        @update:model-value="store.update({ list: { showOperationButtons: $event as boolean } })"
      />
    </div>
    <p class="tip">歌手页的专辑排列方式与排序方向在该页面内切换，不在这里设置。</p>
  </dd>
</template>

<style scoped>
.tip {
  margin-top: 10px;
  color: var(--color-font-label);
  font-size: 12px;
}
</style>
