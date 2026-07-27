<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useSettingsStore } from '../../stores/settings'
import { useApi } from '../../composables/useApi'
import BaseCheckbox from '../../components/BaseCheckbox.vue'

const store = useSettingsStore()
const { settings } = storeToRefs(store)
const api = useApi()

function toggleDesktopLyric(enabled: boolean | string | number): void {
  const on = Boolean(enabled)
  void store.update({ lyrics: { desktopEnabled: on } })
  void api.desktopLyric.toggle(on)
}
</script>

<template>
  <dt id="desktop_lyric">桌面歌词</dt>
  <dd>
    <div>
      <BaseCheckbox
        id="setting_dl_enable"
        :model-value="settings.lyrics.desktopEnabled"
        label="启用桌面歌词"
        @update:model-value="toggleDesktopLyric"
      />
    </div>
    <template v-if="settings.lyrics.desktopEnabled">
      <div class="gap-top row">
        <span class="row-label">字号</span>
        <input
          class="num"
          type="number"
          min="16"
          max="60"
          :value="settings.lyrics.desktopFontSize"
          @change="
            store.update({
              lyrics: { desktopFontSize: Number(($event.target as HTMLInputElement).value) }
            })
          "
        />
      </div>
      <div class="gap-top row">
        <span class="row-label">已播放歌词颜色</span>
        <input
          class="color"
          type="color"
          :value="settings.lyrics.desktopColorActive"
          @input="
            store.update({
              lyrics: { desktopColorActive: ($event.target as HTMLInputElement).value }
            })
          "
        />
      </div>
      <div class="gap-top row">
        <span class="row-label">未播放歌词颜色</span>
        <input
          class="color"
          type="color"
          :value="settings.lyrics.desktopColorNormal"
          @input="
            store.update({
              lyrics: { desktopColorNormal: ($event.target as HTMLInputElement).value }
            })
          "
        />
      </div>
      <div class="gap-top row">
        <span class="row-label">背景不透明度</span>
        <input
          class="slider"
          type="range"
          min="0"
          max="0.8"
          step="0.02"
          :value="settings.lyrics.desktopBgOpacity"
          @input="
            store.update({
              lyrics: { desktopBgOpacity: Number(($event.target as HTMLInputElement).value) }
            })
          "
        />
      </div>
    </template>
  </dd>
</template>

<style scoped>
.row {
  display: flex;
  align-items: center;
  gap: 12px;
}
.row-label {
  font-size: 13px;
  color: var(--color-font);
}
.num {
  width: 64px;
  padding: 6px 10px;
  border-radius: var(--form-radius);
  background-color: var(--color-primary-background);
  color: var(--color-font);
  text-align: center;
}
.color {
  width: 48px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: var(--form-radius);
  background: none;
  cursor: pointer;
}
.slider {
  width: 200px;
  accent-color: var(--color-primary);
}
</style>
