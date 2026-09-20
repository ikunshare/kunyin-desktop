<script setup lang="ts">
/**
 * 播放详情页设置（对应 lx-music-desktop 的「播放详情页设置」）。
 * 只放播放页里歌词「怎么显示」的项；「显示不显示翻译/音译」按 LX 的分法归在播放设置。
 */
import { onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useSettingsStore } from '../../stores/settings'
import { useApi } from '../../composables/useApi'
import { listSystemFonts } from '../../composables/useFonts'
import BaseSelect from '../../components/BaseSelect.vue'

const store = useSettingsStore()
const { settings } = storeToRefs(store)
const api = useApi()

const fontList = ref<{ id: string; label: string }[]>([{ id: '', label: '跟随软件字体' }])
onMounted(async () => {
  const platform = await api.app.getPlatform()
  const fonts = await listSystemFonts(platform)
  fontList.value = [
    { id: '', label: '跟随软件字体' },
    ...fonts.map((f) => ({ id: f, label: f.replace(/(^"|"$)/g, '') }))
  ]
})

function setLyricFont(font: string): void {
  void store.update({ lyrics: { font } })
}
</script>

<template>
  <dt id="play_detail">播放详情页设置</dt>
  <dd>
    <h3 id="play_detail_font">歌词字体</h3>
    <div>
      <BaseSelect
        :model-value="settings.lyrics.font"
        :list="fontList"
        @update:model-value="setLyricFont"
      />
      <p class="tip">留空则跟随「基本设置」里的软件字体。</p>
    </div>
  </dd>
</template>

<style scoped>
.tip {
  margin-top: 10px;
  color: var(--color-font-label);
  font-size: 12px;
}
</style>
