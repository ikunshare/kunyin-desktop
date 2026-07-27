<script setup lang="ts">
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useRouter } from 'vue-router'
import AppIcon from './AppIcon.vue'
import { usePlayerStore } from '../stores/player'
import { useLibraryStore } from '../stores/library'
import { coverUrl } from '../utils/cover'

const router = useRouter()
const player = usePlayerStore()
const library = useLibraryStore()
const { current, playing, currentTime, duration, volume, muted, playMode, error } =
  storeToRefs(player)

const liked = computed(() => (current.value ? library.isFavorite(current.value) : false))
function toggleLike(): void {
  if (current.value) void library.toggleFavorite(current.value)
}

const progress = computed(() =>
  duration.value > 0 ? Math.min(100, (currentTime.value / duration.value) * 100) : 0
)

function fmt(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '--:--'
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
const timeText = computed(() => `${fmt(currentTime.value)} / ${fmt(duration.value)}`)

function openPlayer(): void {
  if (current.value) void router.push({ name: 'player' })
}

// 音量弹层
const volOpen = ref(false)
const volIcon = computed(() => (muted.value || volume.value === 0 ? 'volume-mute' : 'volume'))
let volCloseTimer: ReturnType<typeof setTimeout> | null = null
function openVol(): void {
  if (volCloseTimer) {
    clearTimeout(volCloseTimer)
    volCloseTimer = null
  }
  volOpen.value = true
}
function closeVol(): void {
  // 短延迟关闭：按钮→弹层斜向移动时短暂离界不闪关
  if (volCloseTimer) clearTimeout(volCloseTimer)
  volCloseTimer = setTimeout(() => (volOpen.value = false), 200)
}
function onVolInput(e: Event): void {
  player.setVolume(Number((e.target as HTMLInputElement).value))
}

// 播放模式
const PLAY_MODE_META: Record<string, { icon: string; label: string }> = {
  listLoop: { icon: 'repeat', label: '列表循环' },
  singleLoop: { icon: 'repeat-one', label: '单曲循环' },
  random: { icon: 'shuffle', label: '随机播放' }
}
const modeMeta = computed(() => PLAY_MODE_META[playMode.value] ?? PLAY_MODE_META.listLoop)
</script>

<template>
  <footer class="player">
    <div class="progress">
      <div class="progress-fill" :style="{ width: progress + '%' }" />
    </div>

    <!-- LX FullWidthProgress：封面 | 信息 | 时间 | 小控制 | 播放键 -->
    <div class="cover" :class="{ clickable: current }" @click="openPlayer">
      <img v-if="current?.cover" :src="coverUrl(current.cover)" alt="" />
      <div v-else class="cover-empty"><AppIcon name="library" :size="18" /></div>
    </div>

    <div class="info">
      <div class="title ellipsis">{{ current?.title || '未在播放' }}</div>
      <!-- 播放失败时占用艺术家行：失败原因必须可见，否则用户只能靠 devtools 猜 -->
      <div v-if="error" class="err ellipsis" :title="error">{{ error }}</div>
      <div v-else class="artist ellipsis">{{ current?.artist || '选一首歌开始' }}</div>
    </div>

    <div class="time">{{ timeText }}</div>

    <div class="controls">
      <button class="act" :class="{ liked }" title="收藏" :disabled="!current" @click="toggleLike">
        <AppIcon :name="liked ? 'heart-filled' : 'heart'" :size="17" />
      </button>
      <button class="act" :title="modeMeta.label" @click="player.cyclePlayMode()">
        <AppIcon :name="modeMeta.icon" :size="17" />
      </button>
      <div class="vol-wrap" @mouseenter="openVol" @mouseleave="closeVol">
        <button class="act" title="音量" @click="player.toggleMute()">
          <AppIcon :name="volIcon" :size="17" />
        </button>
        <div v-show="volOpen" class="vol-pop">
          <input
            class="vol-slider"
            type="range"
            min="0"
            max="1"
            step="0.01"
            :value="muted ? 0 : volume"
            @input="onVolInput"
          />
        </div>
      </div>
    </div>

    <div class="play-btns">
      <button class="ctrl" title="上一首" @click="player.prev()">
        <AppIcon name="skip-back" :size="19" />
      </button>
      <button class="play" :title="playing ? '暂停' : '播放'" @click="player.toggle()">
        <AppIcon :name="playing ? 'pause' : 'play'" :size="25" />
      </button>
      <button class="ctrl" title="下一首" @click="player.next()">
        <AppIcon name="skip-forward" :size="19" />
      </button>
    </div>
  </footer>
</template>

<style scoped>
.player {
  position: relative;
  flex: none;
  height: var(--height-player);
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 6px 6px;
}
.progress {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 2px;
  background-color: var(--color-primary-background);
}
.progress-fill {
  height: 100%;
  background-color: var(--color-primary);
  transition: width 0.2s linear;
}

/* 封面：高=栏内容高，正方形 */
.cover {
  flex: none;
  height: 100%;
  aspect-ratio: 1 / 1;
  border-radius: var(--radius-border);
  overflow: hidden;
  box-shadow: 0 0 2px rgba(0, 0, 0, 0.3);
}
.cover.clickable {
  cursor: pointer;
}
.cover.clickable:hover {
  box-shadow: 0 0 4px rgba(0, 0, 0, 0.4);
}
.cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.cover-empty {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-font-label);
  background-color: var(--color-primary-light-900-alpha-200);
}

.info {
  flex: 1;
  min-width: 0;
}
.title {
  font-size: 13px;
  font-weight: 500;
  color: var(--color-font);
}
.artist {
  font-size: 12px;
  color: var(--color-font-label);
}
.err {
  font-size: 12px;
  color: #d9534f;
}

.time {
  flex: none;
  padding: 0 4px;
  font-size: 13px;
  color: var(--color-550);
  font-variant-numeric: tabular-nums;
}

/* 小控制按钮：24px 宽，opacity .6 → hover 1（LX ControlBtns） */
.controls {
  flex: none;
  display: flex;
  align-items: center;
  gap: 10px;
}
.act {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  color: var(--color-button-font);
  opacity: 0.6;
  transition: opacity 0.2s ease;
}
.act:hover:not(:disabled) {
  opacity: 1;
}
.act.liked {
  color: var(--color-primary);
  opacity: 1;
}
.act:disabled {
  opacity: 0.3;
  cursor: default;
}

.vol-wrap {
  position: relative;
  display: flex;
  align-items: center;
}
.vol-pop {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 50%;
  transform: translateX(-50%);
  padding: 12px 8px;
  border-radius: var(--radius-border);
  background-color: var(--color-content-background);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
}
/* 隐形桥接区：填平按钮与弹层之间的空隙，移向滑杆途中不触发 mouseleave */
.vol-pop::after {
  content: '';
  position: absolute;
  top: 100%;
  left: -12px;
  right: -12px;
  height: 10px;
}
.vol-slider {
  writing-mode: vertical-lr;
  direction: rtl;
  width: 4px;
  height: 90px;
  accent-color: var(--color-primary);
  cursor: pointer;
}

/* 播放键组：最右侧，gap 18px，右 padding 15px */
.play-btns {
  flex: none;
  display: flex;
  align-items: center;
  gap: 18px;
  padding-right: 15px;
}
.ctrl {
  display: flex;
  color: var(--color-button-font);
  transition: color 0.2s ease;
}
.ctrl:hover {
  color: var(--color-primary-font);
}
.play {
  display: flex;
  color: var(--color-primary);
  transition:
    color 0.2s ease,
    transform 0.15s ease;
}
.play:hover {
  color: var(--color-primary-font-hover);
}
.play:active {
  transform: scale(0.9);
}
</style>
