<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useSettingsStore } from '../../stores/settings'
import {
  AI_QUALITY_CANDIDATES,
  QUALITY_IDS,
  QUALITY_NAMES,
  blockedQualityIds,
  qualityFallbackOrder,
  type QualityId
} from '@common'
import BaseCheckbox from '../../components/BaseCheckbox.vue'
import BaseSelect from '../../components/BaseSelect.vue'

const store = useSettingsStore()
const { settings } = storeToRefs(store)

const blocked = computed(() => blockedQualityIds(settings.value))

// 被屏蔽的档位不作为首选（当前值若已被屏蔽仍保留在列表里，避免下拉显示空白）
const qualityList = computed(() =>
  QUALITY_IDS.filter(
    (q) => !blocked.value.includes(q) || q === settings.value.player.preferredQuality
  ).map((q) => ({ id: q as string, label: QUALITY_NAMES[q] }))
)

const aiList = AI_QUALITY_CANDIDATES.map((q) => ({ id: q, label: QUALITY_NAMES[q] }))

function setQuality(id: string): void {
  void store.update({ player: { preferredQuality: id as QualityId } })
}

/** 首选音质落在被屏蔽档时，降到最近的未屏蔽可用档，免得每次播放都白试一轮 */
function fixPreferred(blockedIds: readonly string[]): QualityId | null {
  const cur = settings.value.player.preferredQuality
  if (!blockedIds.includes(cur)) return null
  const next = qualityFallbackOrder(cur, undefined, blockedIds)[0]
  return (next as QualityId) ?? 'flac'
}

function setBlockAi(on: boolean): void {
  const next = fixPreferred(on ? settings.value.quality.aiQualities : [])
  void store.update({
    quality: { blockAi: on },
    ...(next ? { player: { preferredQuality: next } } : {})
  })
}

function toggleAiQuality(id: QualityId, on: boolean): void {
  const cur = settings.value.quality.aiQualities
  const list = on ? [...new Set([...cur, id])] : cur.filter((q) => q !== id)
  const next = settings.value.quality.blockAi ? fixPreferred(list) : null
  void store.update({
    quality: { aiQualities: list },
    ...(next ? { player: { preferredQuality: next } } : {})
  })
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

  <dd>
    <h3 id="play_block_ai">AI 音质</h3>
    <div>
      <BaseCheckbox
        id="setting_quality_block_ai"
        :model-value="settings.quality.blockAi"
        label="屏蔽 AI 音质（播放与下载均跳过这些版本）"
        @update:model-value="setBlockAi($event as boolean)"
      />
      <div v-for="q in aiList" :key="q.id" class="gap-top gap-left">
        <BaseCheckbox
          :id="`setting_quality_ai_${q.id}`"
          :model-value="settings.quality.aiQualities.includes(q.id)"
          :disabled="!settings.quality.blockAi"
          :label="q.label"
          @update:model-value="toggleAiQuality(q.id, $event as boolean)"
        />
      </div>
    </div>
  </dd>
</template>
