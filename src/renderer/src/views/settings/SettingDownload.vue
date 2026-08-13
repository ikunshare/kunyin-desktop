<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useSettingsStore } from '../../stores/settings'
import { QUALITY_IDS, QUALITY_NAMES, type AppSettings, type QualityId } from '@common'
import BaseCheckbox from '../../components/BaseCheckbox.vue'
import BaseSelect from '../../components/BaseSelect.vue'

const store = useSettingsStore()
const { settings } = storeToRefs(store)

const namingList = [
  { id: 'artist-title', label: '歌手 - 歌名' },
  { id: 'title-artist', label: '歌名 - 歌手' },
  { id: 'title-only', label: '仅歌名' }
]

// 音质从高到低（与下载弹窗一致）
const qualityList = [...QUALITY_IDS].reverse().map((id) => ({ id, label: QUALITY_NAMES[id] }))

function setNaming(id: string): void {
  void store.update({
    download: { namingStyle: id as AppSettings['download']['namingStyle'] }
  })
}

function setQuality(id: string): void {
  void store.update({ download: { preferredQuality: id as QualityId } })
}
</script>

<template>
  <dt id="download">下载设置</dt>
  <dd>
    <h3 id="download_quality">优先下载音质</h3>
    <div>
      <BaseSelect
        :model-value="settings.download.preferredQuality"
        :list="qualityList"
        @update:model-value="setQuality"
      />
    </div>
  </dd>
  <dd>
    <h3 id="download_naming">命名方式</h3>
    <div>
      <BaseSelect
        :model-value="settings.download.namingStyle"
        :list="namingList"
        @update:model-value="setNaming"
      />
    </div>
  </dd>
  <dd>
    <h3 id="download_concurrent">同时下载数</h3>
    <div>
      <input
        class="num"
        type="number"
        min="1"
        max="8"
        :value="settings.download.maxConcurrent"
        @change="
          store.update({
            download: { maxConcurrent: Number(($event.target as HTMLInputElement).value) }
          })
        "
      />
    </div>
  </dd>
  <dd>
    <h3 id="download_extra">附加文件</h3>
    <div>
      <div>
        <BaseCheckbox
          id="setting_dl_quality_tag"
          :model-value="settings.download.appendQualityTag"
          label="无损文件名附加音质标记"
          @update:model-value="store.update({ download: { appendQualityTag: $event as boolean } })"
        />
      </div>
      <div class="gap-top">
        <BaseCheckbox
          id="setting_dl_album_cover"
          :model-value="settings.download.saveAlbumCover"
          label="整专单独保存封面"
          @update:model-value="store.update({ download: { saveAlbumCover: $event as boolean } })"
        />
      </div>
      <div class="gap-top">
        <BaseCheckbox
          id="setting_dl_lrc"
          :model-value="settings.download.saveLrcFile"
          label="额外保存 .lrc 歌词"
          @update:model-value="store.update({ download: { saveLrcFile: $event as boolean } })"
        />
      </div>
      <div class="gap-top">
        <BaseCheckbox
          id="setting_dl_lyric_meta"
          :model-value="settings.download.writeLyricMeta"
          label="歌词写入音频标签"
          @update:model-value="store.update({ download: { writeLyricMeta: $event as boolean } })"
        />
      </div>
    </div>
  </dd>
</template>

<style scoped>
.num {
  width: 64px;
  padding: 6px 10px;
  border-radius: var(--form-radius);
  background-color: var(--color-primary-background);
  color: var(--color-font);
  text-align: center;
}
</style>
