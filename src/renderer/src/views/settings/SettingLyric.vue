<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useSettingsStore } from '../../stores/settings'
import { useApi } from '../../composables/useApi'
import { listSystemFonts } from '../../composables/useFonts'
import BaseCheckbox from '../../components/BaseCheckbox.vue'
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
  <dt id="lyric">歌词设置</dt>
  <dd>
    <h3 id="lyric_content">歌词内容</h3>
    <div>
      <div>
        <BaseCheckbox
          id="setting_lyric_translation"
          :model-value="settings.lyrics.showTranslation"
          label="显示歌词翻译"
          @update:model-value="store.update({ lyrics: { showTranslation: $event as boolean } })"
        />
      </div>
      <div class="gap-top">
        <BaseCheckbox
          id="setting_lyric_roman"
          :model-value="settings.lyrics.showRomanization"
          label="显示歌词音译"
          @update:model-value="store.update({ lyrics: { showRomanization: $event as boolean } })"
        />
      </div>
    </div>
  </dd>
  <dd>
    <h3 id="lyric_font">歌词字体</h3>
    <div>
      <BaseSelect
        :model-value="settings.lyrics.font"
        :list="fontList"
        @update:model-value="setLyricFont"
      />
    </div>
  </dd>
</template>
