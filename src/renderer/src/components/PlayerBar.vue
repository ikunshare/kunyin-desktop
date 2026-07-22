<script setup lang="ts">
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useRouter } from 'vue-router'
import AppIcon from './AppIcon.vue'
import { usePlayerStore } from '../stores/player'
import { useLibraryStore } from '../stores/library'

const router = useRouter()
const player = usePlayerStore()
const library = useLibraryStore()
const { current, playing, currentTime, duration, volume, muted, playMode } = storeToRefs(player)

const liked = computed(() => (current.value ? library.isFavorite(current.value) : false))
function toggleLike(): void {
  if (current.value) void library.toggleFavorite(current.value)
}

const progress = computed(() =>
  duration.value > 0 ? Math.min(100, (currentTime.value / duration.value) * 100) : 0
)

function openPlayer(): void {
  if (current.value) void router.push({ name: 'player' })
}

// 音量弹层
const volOpen = ref(false)
const volIcon = computed(() => (muted.value || volume.value === 0 ? 'volume-mute' : 'volume'))
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

    <div class="info" :class="{ clickable: current }" @click="openPlayer">
      <div class="cover">
        <img v-if="current?.cover" :src="current.cover" alt="" />
        <div v-else class="cover-empty"><AppIcon name="library" :size="18" /></div>
      </div>
      <div class="meta">
        <div class="title ellipsis">{{ current?.title || '未在播放' }}</div>
        <div class="artist ellipsis">{{ current?.artist || '选一首歌开始' }}</div>
      </div>
    </div>

    <div class="controls">
      <button class="ctrl" title="上一首" @click="player.prev()">
        <AppIcon name="skip-back" :size="20" />
      </button>
      <button class="play" :title="playing ? '暂停' : '播放'" @click="player.toggle()">
        <AppIcon :name="playing ? 'pause' : 'play'" :size="26" />
      </button>
      <button class="ctrl" title="下一首" @click="player.next()">
        <AppIcon name="skip-forward" :size="20" />
      </button>
    </div>

    <div class="actions">
      <button class="act" :class="{ liked }" title="收藏" :disabled="!current" @click="toggleLike">
        <AppIcon :name="liked ? 'heart-filled' : 'heart'" :size="17" />
      </button>
      <button class="act" :title="modeMeta.label" @click="player.cyclePlayMode()">
        <AppIcon :name="modeMeta.icon" :size="17" />
      </button>
      <div class="vol-wrap" @mouseenter="volOpen = true" @mouseleave="volOpen = false">
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
  </footer>
</template>

<style scoped>
.player {
  position: relative;
  flex: none;
  height: var(--height-player);
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 8px 15px;
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

.info {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.info.clickable {
  cursor: pointer;
}
.cover {
  flex: none;
  width: 48px;
  height: 48px;
  border-radius: var(--radius-border);
  overflow: hidden;
  box-shadow: 0 0 2px rgba(0, 0, 0, 0.3);
}
.info.clickable:hover .cover {
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
  background-color: var(--color-primary-background);
}
.meta {
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

.controls {
  flex: none;
  display: flex;
  align-items: center;
  gap: 18px;
}
.ctrl {
  display: flex;
  color: var(--color-font-label);
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

.actions {
  flex: none;
  display: flex;
  align-items: center;
  gap: 14px;
}
.act {
  display: flex;
  color: var(--color-font-label);
  transition: color 0.2s ease;
}
.act:hover:not(:disabled) {
  color: var(--color-primary-font);
}
.act.liked {
  color: var(--color-primary);
}
.act:disabled {
  opacity: 0.4;
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
.vol-slider {
  writing-mode: vertical-lr;
  direction: rtl;
  width: 4px;
  height: 90px;
  accent-color: var(--color-primary);
  cursor: pointer;
}
</style>
