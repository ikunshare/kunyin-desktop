<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useSettingsStore } from '../../stores/settings'
import {
  QUALITY_IDS,
  QUALITY_NAMES,
  blockedQualityIds,
  type AppSettings,
  type QualityId
} from '@common'
import BaseCheckbox from '../../components/BaseCheckbox.vue'
import BaseSelect from '../../components/BaseSelect.vue'
import BaseBtn from '../../components/BaseBtn.vue'

const store = useSettingsStore()
const { settings } = storeToRefs(store)

const namingList = [
  { id: 'artist-title', label: '歌手 - 歌名' },
  { id: 'title-artist', label: '歌名 - 歌手' },
  { id: 'title-only', label: '仅歌名' }
]

const lrcFormatList = [
  { id: 'utf8', label: 'UTF-8' },
  { id: 'gbk', label: 'GBK' }
]

// 音质从高到低（与下载弹窗一致）；屏蔽的 AI 音质不可选，当前值除外
const qualityList = computed(() => {
  const blocked = blockedQualityIds(settings.value)
  return [...QUALITY_IDS]
    .reverse()
    .filter((id) => !blocked.includes(id) || id === settings.value.download.preferredQuality)
    .map((id) => ({ id, label: QUALITY_NAMES[id] }))
})

function setNaming(id: string): void {
  void store.update({
    download: { namingStyle: id as AppSettings['download']['namingStyle'] }
  })
}

function setQuality(id: string): void {
  void store.update({ download: { preferredQuality: id as QualityId } })
}

function setLrcFormat(id: string): void {
  void store.update({ download: { lrcFormat: id as AppSettings['download']['lrcFormat'] } })
}

async function changePath(): Promise<void> {
  const dir = await window.api.shell
    .selectDirectory(settings.value.download.path || undefined)
    .catch(() => null)
  if (dir) void store.update({ download: { path: dir } })
}

function openDir(): void {
  const p = settings.value.download.path
  if (p) void window.api.shell.openPath(p)
}
</script>

<template>
  <dt id="download">下载设置</dt>

  <dd>
    <div>
      <BaseCheckbox
        id="setting_download_enable"
        :model-value="settings.download.enabled"
        label="启用下载功能"
        @update:model-value="store.update({ download: { enabled: $event as boolean } })"
      />
      <div class="gap-top">
        <BaseCheckbox
          id="setting_download_skip_exist_file"
          :model-value="settings.download.skipExistFile"
          label="跳过已存在的文件"
          @update:model-value="store.update({ download: { skipExistFile: $event as boolean } })"
        />
      </div>
      <div class="gap-top">
        <BaseCheckbox
          id="setting_download_overwrite"
          :model-value="settings.download.overwriteExisting"
          :disabled="settings.download.skipExistFile"
          label="覆盖同名文件（关闭时自动追加序号）"
          @update:model-value="store.update({ download: { overwriteExisting: $event as boolean } })"
        />
      </div>
      <div class="gap-top">
        <BaseCheckbox
          id="setting_download_group_by_list"
          :model-value="settings.download.groupByListName"
          label="按歌单名分组保存到子目录"
          @update:model-value="store.update({ download: { groupByListName: $event as boolean } })"
        />
      </div>
    </div>
  </dd>

  <dd :aria-label="'下载路径'">
    <h3 id="download_path">下载路径</h3>
    <div>
      <p class="p path">
        {{ settings.download.path || '默认（系统音乐目录 / KUNYIN）' }}
      </p>
      <div class="p gap-top path-btns">
        <BaseBtn min @click="changePath">更改</BaseBtn>
        <BaseBtn min :disabled="!settings.download.path" @click="openDir">打开目录</BaseBtn>
      </div>
    </div>
  </dd>

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
      <div class="gap-top">
        <BaseCheckbox
          id="setting_download_track_number"
          :model-value="settings.download.trackNumberPrefix"
          label="整专下载文件名前缀曲目号（如 01.歌手 - 歌名）"
          @update:model-value="store.update({ download: { trackNumberPrefix: $event as boolean } })"
        />
      </div>
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
    <h3 id="download_data_embed">写入音频标签</h3>
    <div>
      <BaseCheckbox
        id="setting_dl_embed_cover"
        :model-value="settings.download.embedCover"
        label="嵌入歌曲封面"
        @update:model-value="store.update({ download: { embedCover: $event as boolean } })"
      />
      <div class="gap-top">
        <BaseCheckbox
          id="setting_dl_embed_lyric"
          :model-value="settings.download.embedLyric"
          label="嵌入歌词"
          @update:model-value="store.update({ download: { embedLyric: $event as boolean } })"
        />
      </div>
      <div class="gap-top gap-left">
        <BaseCheckbox
          id="setting_dl_embed_lyric_t"
          :model-value="settings.download.embedLyricT"
          :disabled="!settings.download.embedLyric"
          label="嵌入翻译歌词"
          @update:model-value="store.update({ download: { embedLyricT: $event as boolean } })"
        />
      </div>
      <div class="gap-top gap-left">
        <BaseCheckbox
          id="setting_dl_embed_lyric_r"
          :model-value="settings.download.embedLyricR"
          :disabled="!settings.download.embedLyric"
          label="嵌入罗马音歌词"
          @update:model-value="store.update({ download: { embedLyricR: $event as boolean } })"
        />
      </div>
      <div class="gap-top gap-left">
        <BaseCheckbox
          id="setting_dl_embed_lyric_lx"
          :model-value="settings.download.embedLyricLx"
          :disabled="!settings.download.embedLyric"
          label="嵌入逐字歌词"
          @update:model-value="store.update({ download: { embedLyricLx: $event as boolean } })"
        />
      </div>
    </div>
  </dd>

  <dd>
    <h3 id="download_lyric">歌词文件</h3>
    <div>
      <BaseCheckbox
        id="setting_dl_lrc"
        :model-value="settings.download.saveLrcFile"
        label="额外保存 .lrc 歌词文件"
        @update:model-value="store.update({ download: { saveLrcFile: $event as boolean } })"
      />
      <div class="gap-top gap-left">
        <BaseCheckbox
          id="setting_dl_lrc_t"
          :model-value="settings.download.saveLrcT"
          :disabled="!settings.download.saveLrcFile"
          label="附带翻译歌词"
          @update:model-value="store.update({ download: { saveLrcT: $event as boolean } })"
        />
      </div>
      <div class="gap-top gap-left">
        <BaseCheckbox
          id="setting_dl_lrc_r"
          :model-value="settings.download.saveLrcR"
          :disabled="!settings.download.saveLrcFile"
          label="附带罗马音歌词"
          @update:model-value="store.update({ download: { saveLrcR: $event as boolean } })"
        />
      </div>
      <div class="gap-top gap-left">
        <BaseCheckbox
          id="setting_dl_lrc_lx"
          :model-value="settings.download.saveLrcLx"
          :disabled="!settings.download.saveLrcFile"
          label="附带逐字歌词"
          @update:model-value="store.update({ download: { saveLrcLx: $event as boolean } })"
        />
      </div>
    </div>

    <h3 id="download_lyric_format">歌词编码</h3>
    <div>
      <BaseCheckbox
        v-for="item in lrcFormatList"
        :id="`setting_dl_lrc_format_${item.id}`"
        :key="item.id"
        name="setting_download_lrc_format"
        need
        :value="item.id"
        :model-value="settings.download.lrcFormat"
        :label="item.label"
        @update:model-value="setLrcFormat($event as string)"
      />
    </div>
  </dd>

  <dd>
    <h3 id="download_extra">附加</h3>
    <div>
      <BaseCheckbox
        id="setting_dl_quality_tag"
        :model-value="settings.download.appendQualityTag"
        label="无损文件名附加音质标记"
        @update:model-value="store.update({ download: { appendQualityTag: $event as boolean } })"
      />
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
          id="setting_dl_other_source"
          :model-value="settings.download.useOtherSource"
          label="音源不可用时换源下载"
          @update:model-value="store.update({ download: { useOtherSource: $event as boolean } })"
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
.path {
  color: var(--color-font);
  word-break: break-all;
}
.path-btns {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
</style>
