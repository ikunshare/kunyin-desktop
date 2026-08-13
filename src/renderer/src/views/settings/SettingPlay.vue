<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useSettingsStore } from '../../stores/settings'
import { QUALITY_IDS, QUALITY_NAMES, type QualityId } from '@common'
import BaseSelect from '../../components/BaseSelect.vue'

const store = useSettingsStore()
const { settings } = storeToRefs(store)

const qualityList = QUALITY_IDS.map((q) => ({ id: q as string, label: QUALITY_NAMES[q] }))

function setQuality(id: string): void {
  void store.update({ player: { preferredQuality: id as QualityId } })
}
</script>

<template>
  <dt id="play">播放设置</dt>
  <dd>
    <h3 id="play_quality">首选音质</h3>
    <div>
      <BaseSelect
        :model-value="settings.player.preferredQuality"
        :list="qualityList"
        @update:model-value="setQuality"
      />
    </div>
  </dd>
</template>

