<script setup lang="ts">
/**
 * 音效弹窗（播放页）。对应 lx-music-desktop 播放栏的 `SoundEffectBtn`：
 * 均衡器 / 环境混响 / 3D 立体环绕 / 升降调 四块并排，边听边调。
 *
 * 这些都是「听着调」的项，所以不留在设置页而挂到播放页——与 LX 的归属一致。
 * 只有「最大声道输出」这种一次性开关留在设置页的「播放设置」里（LX 也在那儿）。
 *
 * 滑杆 `@input` 只做实时试听（previewSoundEffect 直接改处理图），`@change` 才落盘——
 * 设置每写一次就是一次 JSON 原子写，按住滑杆拖会写成百上千次。
 *
 * 外观沿用 SleepTimerDialog 那套原生 <dialog>：进入浏览器顶层，避开播放页的
 * overflow / transform，并自带焦点约束与恢复。
 */
import { computed, onMounted, ref } from 'vue'
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
import { useSettingsStore } from '../stores/settings'
import { previewSoundEffect } from '../audio/soundEffect'
import AppIcon from './AppIcon.vue'
import BaseBtn from './BaseBtn.vue'
import BaseCheckbox from './BaseCheckbox.vue'
import BaseSelect from './BaseSelect.vue'

type SoundEffect = AppSettings['player']['soundEffect']

const emit = defineEmits<{ close: [] }>()

const store = useSettingsStore()
const { settings } = storeToRefs(store)
const dialog = ref<HTMLDialogElement>()

const effect = computed<SoundEffect>(() => settings.value.player.soundEffect)
const eqGains = computed(() => normalizeEqGains(effect.value.eq))

/** 频点标签：1000 以上写成 1k/16k，与 LX 一致 */
const eqLabels = EQ_FREQS.map((hz) => (hz < 1000 ? String(hz) : `${hz / 1000}k`))

onMounted(() => dialog.value?.showModal())
function close(): void {
  dialog.value?.close()
  emit('close')
}

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
  <dialog
    ref="dialog"
    class="effect-dialog"
    aria-labelledby="effect-dialog-title"
    @cancel.prevent="close"
    @click.self="close"
  >
    <div class="effect-content">
      <header>
        <h2 id="effect-dialog-title">音效</h2>
        <BaseBtn min @click="close()">关闭</BaseBtn>
      </header>

      <div class="columns">
        <section class="col">
          <div class="sec-head">
            <h3>均衡器</h3>
            <BaseBtn min @click="resetEq()">重置</BaseBtn>
          </div>
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
          </div>
        </section>

        <section class="col">
          <div class="sec-head">
            <h3>环境混响</h3>
            <BaseSelect
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

          <div class="sec-head gap">
            <h3>3D 立体环绕 <span class="hint">戴耳机才听得出来</span></h3>
            <BaseCheckbox
              id="se-panner"
              :model-value="effect.pannerEnabled"
              label="启用"
              @update:model-value="patch({ pannerEnabled: !!$event })"
            />
          </div>
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

          <div class="sec-head gap">
            <h3>升降调</h3>
            <BaseBtn min @click="patch({ pitchFactor: 1 })">重置为原调</BaseBtn>
          </div>
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
          <p class="tip">
            <AppIcon name="info" :size="13" />
            <span
              >升降调要实时重算音频数据，CPU 占用会明显上升；机器吃不消时声音会发怪，
              暂停一会儿等它消化完再播即可。</span
            >
          </p>
        </section>
      </div>

      <footer>
        <p class="tip">
          音效全部处于默认值时不接入音频处理图，播放链路与关闭本功能时完全一致；
          启用任一项后音频改由处理图输出，这一步不可逆（浏览器不允许解除），
          但调回默认后处理图是透明的，不影响音质。
        </p>
        <BaseBtn min @click="resetAll()">全部恢复默认</BaseBtn>
      </footer>
    </div>
  </dialog>
</template>

<style scoped>
.effect-dialog {
  zoom: var(--app-zoom, 1);
  margin: auto;
  padding: 0;
  width: min(820px, calc(100% - 32px));
  max-height: calc(100% - 32px);
  overflow: auto;
  border: 1px solid var(--color-primary-alpha-900);
  border-radius: 16px;
  background:
    linear-gradient(var(--color-main-background), var(--color-main-background)),
    var(--color-content-background);
  color: var(--color-font);
  box-shadow: 0 18px 60px #0005;
  -webkit-app-region: no-drag;
}
.effect-dialog::backdrop {
  background: #0006;
}
.effect-content {
  padding: 22px 24px 20px;
  display: flex;
  flex-direction: column;
  gap: 18px;
  font-size: 13px;
}
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
h2 {
  font-size: 18px;
  font-weight: 600;
}
.columns {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 18px 28px;
}
.col {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.sec-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 12px;
}
.sec-head.gap {
  margin-top: 22px;
}
h3 {
  font-size: 14px;
  font-weight: 600;
}
.hint {
  margin-left: 6px;
  font-size: 11px;
  font-weight: 400;
  color: var(--color-font-label);
}
.eq {
  display: grid;
  gap: 8px;
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
.range-grid {
  display: grid;
  gap: 12px;
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
input[type='range'] {
  width: 100%;
  height: 4px;
  border-radius: 999px;
  accent-color: var(--color-primary);
}
.tip {
  display: flex;
  gap: 6px;
  margin-top: 12px;
  color: var(--color-font-label);
  font-size: 12px;
  line-height: 1.6;
}
footer {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 18px;
  padding-top: 4px;
  border-top: 1px solid var(--color-primary-alpha-900);
}
footer .tip {
  margin-top: 8px;
}
footer :deep(.btn) {
  flex: none;
}
</style>
