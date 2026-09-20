<script setup lang="ts">
/**
 * 音效设置：均衡器 / 环境混响 / 3D 立体环绕 / 升降调 / 最大声道输出。
 * 功能与取值范围对齐 lx-music-desktop 的「音效设置」，常量集中在 @common/audio。
 *
 * 滑杆 `@input` 只做实时试听（previewSoundEffect，直接改处理图），`@change` 才落盘——
 * 设置每写一次就是一次 JSON 原子写，按住滑杆拖会写成百上千次。
 */
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import {
  CONVOLUTION_GAIN_MAX,
  CONVOLUTION_PRESETS,
  EQ_FREQS,
  EQ_GAIN_LIMIT,
  EQ_PRESETS,
  PANNER_RADIUS_RANGE,
  PANNER_SPEED_RANGE,
  PITCH_FACTOR_RANGE,
  flatEqGains,
  normalizeEqGains,
  type AppSettings
} from '@common'
import { useSettingsStore } from '../../stores/settings'
import { previewSoundEffect } from '../../audio/soundEffect'
import BaseCheckbox from '../../components/BaseCheckbox.vue'
import BaseSelect from '../../components/BaseSelect.vue'
import BaseBtn from '../../components/BaseBtn.vue'

type SoundEffect = AppSettings['player']['soundEffect']

const store = useSettingsStore()
const { settings } = storeToRefs(store)

const effect = computed<SoundEffect>(() => settings.value.player.soundEffect)
const eqGains = computed(() => normalizeEqGains(effect.value.eq))

/** 频点标签：1000 以上写成 1k/16k，与 LX 一致 */
const eqLabels = EQ_FREQS.map((hz) => (hz < 1000 ? String(hz) : `${hz / 1000}k`))

function patch(next: Partial<SoundEffect>): void {
  void store.update({ player: { soundEffect: next } })
}
/** 只试听不落盘（滑杆拖动中） */
function preview(next: Partial<SoundEffect>): void {
  previewSoundEffect({ ...effect.value, ...next })
}

function numberOf(e: Event): number {
  return Number((e.target as HTMLInputElement).value)
}

function eqWith(index: number, gain: number): number[] {
  const next = [...eqGains.value]
  next[index] = Math.max(-EQ_GAIN_LIMIT, Math.min(EQ_GAIN_LIMIT, Math.round(gain)))
  return next
}

function previewEq(index: number, e: Event): void {
  preview({ eq: eqWith(index, numberOf(e)) })
}
function commitEq(index: number, e: Event): void {
  // 手动拖过之后就不再算「套用了某个预设」，清掉高亮
  patch({ eq: eqWith(index, numberOf(e)), eqPreset: '' })
}
function applyEqPreset(id: string): void {
  const preset = EQ_PRESETS.find((p) => p.id === id)
  if (!preset) return
  patch({ eq: [...preset.gains], eqPreset: id })
}
function resetEq(): void {
  patch({ eq: flatEqGains(), eqPreset: '' })
}

const convolutionList = computed(() => [
  { id: '', label: '关闭' },
  ...CONVOLUTION_PRESETS.map((p) => ({ id: p.id, label: p.name }))
])

/** 选混响时连带套用该预设调好的干/湿增益（LX 的预设里这两个值是配套的） */
function setConvolution(id: string): void {
  const preset = CONVOLUTION_PRESETS.find((p) => p.id === id)
  patch({
    convolution: id,
    ...(preset
      ? { convolutionMainGain: preset.mainGain, convolutionSendGain: preset.sendGain }
      : {})
  })
}

/** 升降调滑杆用百分比刻度（50..150），与 LX 的 0.50x..1.50x 一致 */
const pitchPercent = computed(() => Math.round(effect.value.pitchFactor * 100))

function resetAll(): void {
  patch({
    eq: flatEqGains(),
    eqPreset: '',
    convolution: '',
    convolutionMainGain: 10,
    convolutionSendGain: 0,
    pannerEnabled: false,
    pannerRadius: 5,
    pannerSpeed: 25,
    pitchFactor: 1
  })
}
</script>

<template>
  <dt id="sound_effect">音效设置</dt>
  <dd>
    <h3>
      均衡器
      <span class="hint">拖动即可试听，松手后保存</span>
    </h3>
    <div class="eq">
      <div v-for="(hz, i) in EQ_FREQS" :key="hz" class="eq-band">
        <span class="eq-label">{{ eqLabels[i] }}</span>
        <input
          type="range"
          :min="-EQ_GAIN_LIMIT"
          :max="EQ_GAIN_LIMIT"
          step="1"
          :value="eqGains[i]"
          :aria-label="`${eqLabels[i]} Hz`"
          @input="previewEq(i, $event)"
          @change="commitEq(i, $event)"
        />
        <span class="eq-value">{{ eqGains[i] > 0 ? '+' : '' }}{{ eqGains[i] }} dB</span>
      </div>
    </div>
    <div class="preset-row">
      <BaseBtn
        v-for="preset in EQ_PRESETS"
        :key="preset.id"
        min
        :class="{ chosen: effect.eqPreset === preset.id }"
        @click="applyEqPreset(preset.id)"
        >{{ preset.name }}</BaseBtn
      >
      <BaseBtn min @click="resetEq()">重置</BaseBtn>
    </div>
  </dd>

  <dd>
    <h3>环境混响</h3>
    <div class="control-row">
      <label for="se-convolution">空间</label>
      <BaseSelect
        id="se-convolution"
        :model-value="effect.convolution"
        :list="convolutionList"
        @update:model-value="setConvolution($event as string)"
      />
    </div>
    <div class="range-grid" :class="{ disabled: !effect.convolution }">
      <label class="range-item">
        <span
          >原始音频增益 <b>{{ (effect.convolutionMainGain / 10).toFixed(1) }}</b></span
        >
        <input
          type="range"
          min="0"
          :max="CONVOLUTION_GAIN_MAX"
          step="1"
          :disabled="!effect.convolution"
          :value="effect.convolutionMainGain"
          @input="preview({ convolutionMainGain: numberOf($event) })"
          @change="patch({ convolutionMainGain: numberOf($event) })"
        />
      </label>
      <label class="range-item">
        <span
          >环境音效增益 <b>{{ (effect.convolutionSendGain / 10).toFixed(1) }}</b></span
        >
        <input
          type="range"
          min="0"
          :max="CONVOLUTION_GAIN_MAX"
          step="1"
          :disabled="!effect.convolution"
          :value="effect.convolutionSendGain"
          @input="preview({ convolutionSendGain: numberOf($event) })"
          @change="patch({ convolutionSendGain: numberOf($event) })"
        />
      </label>
    </div>
  </dd>

  <dd>
    <h3>3D 立体环绕 <span class="hint">戴耳机才听得出来</span></h3>
    <BaseCheckbox
      id="se-panner"
      :model-value="effect.pannerEnabled"
      label="启用环绕"
      @update:model-value="patch({ pannerEnabled: !!$event })"
    />
    <div class="range-grid" :class="{ disabled: !effect.pannerEnabled }">
      <label class="range-item">
        <span
          >声音距离 <b>{{ (effect.pannerRadius / 10).toFixed(1) }}</b></span
        >
        <input
          type="range"
          :min="PANNER_RADIUS_RANGE.min"
          :max="PANNER_RADIUS_RANGE.max"
          step="1"
          :disabled="!effect.pannerEnabled"
          :value="effect.pannerRadius"
          @input="preview({ pannerRadius: numberOf($event) })"
          @change="patch({ pannerRadius: numberOf($event) })"
        />
      </label>
      <label class="range-item">
        <span
          >环绕速度 <b>{{ effect.pannerSpeed }}</b></span
        >
        <input
          type="range"
          :min="PANNER_SPEED_RANGE.min"
          :max="PANNER_SPEED_RANGE.max"
          step="1"
          :disabled="!effect.pannerEnabled"
          :value="effect.pannerSpeed"
          @input="preview({ pannerSpeed: numberOf($event) })"
          @change="patch({ pannerSpeed: numberOf($event) })"
        />
      </label>
    </div>
  </dd>

  <dd>
    <h3>升降调</h3>
    <div class="range-grid">
      <label class="range-item">
        <span
          >音调 <b>{{ effect.pitchFactor.toFixed(2) }}×</b></span
        >
        <input
          type="range"
          :min="PITCH_FACTOR_RANGE.min * 100"
          :max="PITCH_FACTOR_RANGE.max * 100"
          step="1"
          :value="pitchPercent"
          @input="preview({ pitchFactor: numberOf($event) / 100 })"
          @change="patch({ pitchFactor: numberOf($event) / 100 })"
        />
      </label>
    </div>
    <div class="preset-row">
      <BaseBtn min @click="patch({ pitchFactor: 1 })">重置为原调</BaseBtn>
    </div>
    <p class="tip">
      升降调要实时重算音频数据，CPU 占用会明显上升。机器吃不消时处理任务会堆积、声音发怪，
      这时暂停一会儿等它消化完再播即可。
    </p>
  </dd>

  <dd>
    <h3>输出</h3>
    <BaseCheckbox
      id="se-max-channels"
      :model-value="effect.maxOutputChannels"
      label="最大声道输出（把输出声道数顶到设备支持的上限）"
      @update:model-value="patch({ maxOutputChannels: !!$event })"
    />
    <p class="tip">
      立体声设备上限就是 2 声道，开了不会有变化；接 5.1／7.1 声卡或 HDMI 时才有意义。
      切换输出设备后会按新设备的上限重新设置。
    </p>
  </dd>

  <dd>
    <h3>关于音效</h3>
    <p class="tip">
      音效全部处于默认值时不会接入音频处理图，播放链路与关闭本功能时完全一致。
      一旦启用任一项，音频改由处理图输出——这是不可逆的（浏览器不允许解除），
      但把所有项调回默认后处理图是透明的，不影响音质。
    </p>
    <div class="preset-row">
      <BaseBtn min @click="resetAll()">全部恢复默认</BaseBtn>
    </div>
  </dd>
</template>

<style scoped>
.eq {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
  gap: 10px 22px;
}
.eq-band {
  display: grid;
  grid-template-columns: 34px 1fr 58px;
  align-items: center;
  gap: 10px;
  font-size: 12px;
}
.eq-label {
  color: var(--color-font-label);
  text-align: right;
}
.eq-value {
  color: var(--color-font-label);
  font-variant-numeric: tabular-nums;
}
.preset-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 14px;
}
.preset-row :deep(.chosen) {
  color: var(--color-primary);
  background: var(--color-primary-background);
}
.control-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  font-size: 13px;
}
.range-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 12px 22px;
  margin-top: 14px;
}
.range-grid.disabled {
  opacity: 0.45;
}
.range-item {
  display: grid;
  gap: 6px;
  font-size: 12px;
}
.range-item b {
  color: var(--color-primary);
  font-variant-numeric: tabular-nums;
}
.tip {
  margin-top: 10px;
  color: var(--color-font-label);
  font-size: 12px;
  line-height: 1.6;
}
</style>
