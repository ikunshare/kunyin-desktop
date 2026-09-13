<script setup lang="ts">
import { computed } from 'vue'
import { usePlayerStore } from '../../stores/player'
import { storeToRefs } from 'pinia'
import { useSettingsStore } from '../../stores/settings'
const player = usePlayerStore()
const experienceOptions = [
  ['autoPlay', '启动后自动续播'],
  ['preloadNext', '提前加载下一首'],
  ['autoSkipOnError', '播放失败后自动跳过'],
  ['autoSwitchSource', '播放失败后尝试其他音源'],
  ['pauseOnDeviceChange', '音频设备断开或切换时暂停'],
  ['qqListenReport', 'QQ 音乐听歌上报（登录后同步最近播放与听歌记录）']
] as const
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
import BaseBtn from '../../components/BaseBtn.vue'
import BaseInput from '../../components/BaseInput.vue'

const store = useSettingsStore()
const { settings } = storeToRefs(store)

const blocked = computed(() => blockedQualityIds(settings.value))

// 音质从高到低（与下载设置、下载弹窗、播放页音质菜单一致）
// 被屏蔽的档位不作为首选（当前值若已被屏蔽仍保留在列表里，避免下拉显示空白）
const qualityList = computed(() =>
  [...QUALITY_IDS]
    .reverse()
    .filter((q) => !blocked.value.includes(q) || q === settings.value.player.preferredQuality)
    .map((q) => ({ id: q as string, label: QUALITY_NAMES[q] }))
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
    <h3>播放体验</h3>
    <div class="experience">
      <BaseCheckbox
        v-for="option in experienceOptions"
        :id="'play-' + option[0]"
        :key="option[0]"
        :model-value="settings.player[option[0]]"
        :label="option[1]"
        @update:model-value="store.update({ player: { [option[0]]: !!$event } })"
      />
      <label class="control-row"
        >播放速度
        <BaseSelect
          :model-value="settings.player.playbackRate"
          :list="
            [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map((rate) => ({ id: rate, label: rate + '×' }))
          "
          @update:model-value="store.update({ player: { playbackRate: Number($event) } })"
        />
      </label>
      <div class="control-row">
        <label for="play-output-device">输出设备</label>
        <BaseSelect
          id="play-output-device"
          :model-value="settings.player.outputDeviceId"
          :list="[
            { id: 'default', label: '系统默认' },
            ...player.devices
              .filter((d) => d.deviceId !== 'default')
              .map((d) => ({ id: d.deviceId, label: d.label || '音频输出设备' }))
          ]"
          @update:model-value="store.update({ player: { outputDeviceId: $event } })"
        />
        <BaseBtn min @click="player.refreshDevices()">刷新</BaseBtn>
      </div>
      <p v-if="player.deviceError" role="status">{{ player.deviceError }}</p>
      <label
        >不喜欢的歌曲／歌手<BaseInput
          multiline
          :model-value="settings.player.dislikeRules"
          placeholder="每行一个歌名；屏蔽歌手请填写 @歌手名"
          @change="
            store.update({ player: { dislikeRules: ($event.target as HTMLTextAreaElement).value } })
          "
        />
      </label>
      <p>队列会跳过匹配项。删除对应行即可取消屏蔽。</p>
    </div>
  </dd>
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

<style scoped>
.experience {
  display: grid;
  gap: 14px;
  font-size: 13px;
}
.experience .control-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}
.experience .selection {
  max-width: 100%;
}
.experience textarea {
  display: block;
  width: min(460px, 100%);
  min-height: 100px;
  margin-top: 8px;
}
.experience p {
  color: var(--color-font-label);
  font-size: 12px;
}
</style>
