<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useSettingsStore } from '../../stores/settings'
import { useApi } from '../../composables/useApi'
import { listSystemFonts } from '../../composables/useFonts'
import { FONT_SIZE_LIST, WINDOW_SIZE_LIST } from '@common'
import BaseCheckbox from '../../components/BaseCheckbox.vue'
import BaseSelect from '../../components/BaseSelect.vue'
import ThemePicker from './components/ThemePicker.vue'

const store = useSettingsStore()
const { settings } = storeToRefs(store)
const api = useApi()

const fontList = ref<{ id: string; label: string }[]>([{ id: '', label: '默认' }])
onMounted(async () => {
  const platform = await api.app.getPlatform()
  const fonts = await listSystemFonts(platform)
  fontList.value = [
    { id: '', label: '默认' },
    ...fonts.map((f) => ({ id: f, label: f.replace(/(^"|"$)/g, '') }))
  ]
})

function setAppFont(font: string): void {
  void store.update({ appearance: { appFont: font } })
}
</script>

<template>
  <dt id="basic">外观与界面</dt>
  <dd>
    <h3 id="basic_theme">主题外观 <span class="hint">右键自定义主题可编辑</span></h3>
    <div>
      <ThemePicker />
    </div>
  </dd>
  <dd>
    <h3 id="basic_behavior">动画与窗口</h3>
    <div class="behavior-options">
      <BaseCheckbox
        id="setting_show_animation"
        :model-value="settings.behavior.showAnimation"
        label="显示动画效果"
        @update:model-value="store.update({ behavior: { showAnimation: $event as boolean } })"
      />
      <BaseCheckbox
        id="setting_random_animation"
        :disabled="!settings.behavior.showAnimation"
        :model-value="settings.behavior.randomAnimation"
        label="弹出层随机动画"
        @update:model-value="store.update({ behavior: { randomAnimation: $event as boolean } })"
      />
      <BaseCheckbox
        id="setting_start_in_fullscreen"
        :model-value="settings.behavior.startInFullscreen"
        label="以全屏模式启动"
        @update:model-value="store.update({ behavior: { startInFullscreen: $event as boolean } })"
      />
      <BaseCheckbox
        id="setting_close_to_tray"
        :model-value="settings.behavior.closeToTray"
        label="关闭窗口时不退出软件，将其最小化到系统托盘"
        @update:model-value="store.update({ behavior: { closeToTray: $event as boolean } })"
      />
    </div>
  </dd>
  <dd>
    <h3 id="basic_window_size">窗口尺寸</h3>
    <div>
      <BaseCheckbox
        v-for="item in WINDOW_SIZE_LIST"
        :id="`setting_window_size_${item.id}`"
        :key="item.id"
        class="gap-left"
        name="setting_window_size"
        need
        :model-value="settings.appearance.windowSizeId"
        :value="item.id"
        :label="item.name"
        @update:model-value="store.update({ appearance: { windowSizeId: $event as number } })"
      />
    </div>
  </dd>
  <dd>
    <h3 id="basic_font_size">字体大小</h3>
    <div>
      <BaseCheckbox
        v-for="item in FONT_SIZE_LIST"
        :id="`setting_font_size_${item.id}`"
        :key="item.id"
        class="gap-left"
        name="setting_font_size"
        need
        :model-value="settings.appearance.fontSize"
        :value="item.id"
        :label="item.name"
        @update:model-value="store.update({ appearance: { fontSize: $event as number } })"
      />
    </div>
  </dd>
  <dd>
    <h3 id="basic_font">软件字体</h3>
    <div>
      <BaseSelect
        :model-value="settings.appearance.appFont"
        :list="fontList"
        @update:model-value="setAppFont"
      />
    </div>
  </dd>
  <dd>
    <h3 id="basic_list">列表</h3>
    <div>
      <BaseCheckbox
        id="setting_list_show_operation_buttons"
        :model-value="settings.list.showOperationButtons"
        label="显示列表操作按钮"
        @update:model-value="store.update({ list: { showOperationButtons: $event as boolean } })"
      />
    </div>
  </dd>
</template>

<style scoped>
.behavior-options {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
}
</style>
