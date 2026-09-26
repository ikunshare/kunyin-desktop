<script setup lang="ts">
/**
 * 播放速度弹层（播放页）。对应 lx-music-desktop 播放栏的 `PlaybackRateBtn`：
 * 0.50x–2.00x 滑杆 + 「保持音调」开关 + 复位按钮，速度不为 1 时按钮高亮。
 *
 * 与设置页那种「调完就放着」的项不同，倍速是边听边调的，所以滑杆 `@input` 走
 * `previewPlaybackRate` 直接改 <audio>，`@change` 才落盘——设置每写一次就是一次
 * JSON 原子写，按住滑杆拖会写成百上千次。
 *
 * 外观跟播放页的「更多」菜单同一套深色玻璃，而不是设置页的 LX 浅绿：这一层浮在
 * 封面取色的流体背景上，用浅色面板会把整页的观感打断。
 */
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import AppIcon from './AppIcon.vue'
import { usePlayerStore } from '../stores/player'
import { useSettingsStore } from '../stores/settings'

const player = usePlayerStore()
const settings = useSettingsStore()
const { settings: cfg } = storeToRefs(settings)

const open = ref(false)

/**
 * 显示用的是**生效中**的倍速（store 里跟着 `<audio>` 走的那个），不是设置里的值：
 * 拖动中只试听不落盘，两者会短暂不一致，而歌词引擎同步的也是前者。
 */
const rate = computed(() => player.playbackRate)
const preservesPitch = computed(() => cfg.value.player.preservesPitch)
/** 常用倍速快捷档 */
const presets = [0.5, 0.75, 1, 1.25, 1.5, 2]

function percentOf(e: Event): number {
  return Number((e.target as HTMLInputElement).value)
}

function preview(e: Event): void {
  player.previewPlaybackRate(percentOf(e) / 100)
}

function commit(value: number): void {
  // 先直接生效：试听改的是 <audio>，若设置值恰好没变（拖回原值、连点同一档），
  // store 里的 watcher 不会触发，光写设置会把元素留在上一次试听的速度上。
  player.previewPlaybackRate(value)
  void settings.update({ player: { playbackRate: value } })
}
</script>

<template>
  <div class="rate-wrap">
    <button
      class="abtn"
      :class="{ active: rate !== 1 }"
      :title="`播放速度 ${rate.toFixed(2)}×`"
      :aria-expanded="open"
      @click="open = !open"
    >
      <AppIcon name="speed" :size="20" />
    </button>
    <template v-if="open">
      <div class="rate-mask" @click="open = false" />
      <div class="rate-panel">
        <div class="rate-head">
          <span class="rate-value">{{ rate.toFixed(2) }}×</span>
          <button class="rate-reset" :disabled="rate === 1" @click="commit(1)">恢复原速</button>
        </div>
        <input
          class="rate-slider"
          type="range"
          min="50"
          max="200"
          step="5"
          :value="Math.round(rate * 100)"
          aria-label="播放速度"
          @input="preview"
          @change="commit(percentOf($event) / 100)"
        />
        <div class="rate-presets">
          <button
            v-for="p in presets"
            :key="p"
            class="rate-preset"
            :class="{ on: rate === p }"
            @click="commit(p)"
          >
            {{ p }}×
          </button>
        </div>
        <label class="rate-pitch">
          <input
            type="checkbox"
            :checked="preservesPitch"
            @change="settings.update({ player: { preservesPitch: !preservesPitch } })"
          />
          <span>保持音调<small>关掉即变速变调</small></span>
        </label>
      </div>
    </template>
  </div>
</template>

<style scoped>
.rate-wrap {
  position: relative;
  display: flex;
}
.abtn {
  display: flex;
  color: #fff;
  opacity: 0.85;
  transition: opacity 0.2s ease;
}
.abtn:hover {
  opacity: 1;
}
.abtn.active {
  opacity: 1;
  color: #8be0a4;
}
/*
 * 弹层挂在 .actions 左侧第二个按钮上，居中展开会探出左栏一截（落在 .content 的
 * 内边距里，页面本身 overflow:hidden 但没到裁掉的程度）。z-index 要压过 .right：
 * .left / .right 都是静态定位，不参与 z 序，带 z-index 的定位子元素才画得上去。
 */
.rate-mask {
  position: fixed;
  inset: 0;
  z-index: 4;
}
.rate-panel {
  position: absolute;
  bottom: calc(100% + 12px);
  left: 50%;
  z-index: 5;
  width: 228px;
  transform: translateX(-50%);
  padding: 12px;
  border-radius: 10px;
  background: rgba(34, 34, 36, 0.92);
  backdrop-filter: blur(24px);
  box-shadow: 0 10px 34px rgba(0, 0, 0, 0.45);
  color: rgba(255, 255, 255, 0.92);
}
.rate-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
}
.rate-value {
  font-variant-numeric: tabular-nums;
}
.rate-reset {
  padding: 3px 8px;
  border-radius: 6px;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.8);
  background: rgba(255, 255, 255, 0.12);
  transition: background 0.15s ease;
}
.rate-reset:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.2);
}
.rate-reset:disabled {
  opacity: 0.4;
  cursor: default;
}
.rate-slider {
  width: 100%;
  height: 4px;
  margin: 12px 0 10px;
  border-radius: 999px;
  accent-color: #fff;
}
.rate-presets {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 4px;
}
.rate-preset {
  padding: 4px 0;
  border-radius: 6px;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.72);
  background: rgba(255, 255, 255, 0.08);
  font-variant-numeric: tabular-nums;
  transition: background 0.15s ease;
}
.rate-preset:hover {
  background: rgba(255, 255, 255, 0.16);
}
.rate-preset.on {
  color: #fff;
  background: rgba(255, 255, 255, 0.26);
}
.rate-pitch {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-top: 12px;
  font-size: 12px;
  cursor: pointer;
}
.rate-pitch input {
  margin-top: 1px;
  accent-color: #fff;
}
.rate-pitch small {
  display: block;
  margin-top: 2px;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.5);
}
</style>
