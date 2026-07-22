<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useRouter } from 'vue-router'
import AppIcon from '../components/AppIcon.vue'
import FluidBackground from '../components/FluidBackground.vue'
import { usePlayerStore } from '../stores/player'
import { useLibraryStore } from '../stores/library'
import { useCoverColors } from '../composables/useCoverColors'
import { useLyricPlayer } from '../composables/useLyricPlayer'
import { useApi } from '../composables/useApi'
import { useSettingsStore } from '../stores/settings'

const router = useRouter()
const player = usePlayerStore()
const library = useLibraryStore()
const settings = useSettingsStore()
const api = useApi()
const { current, playing, currentTime, duration } = storeToRefs(player)

const track = computed(() => current.value)
const cover = computed(() => track.value?.cover ?? '')
const colors = useCoverColors(cover)

const displayDuration = computed(() =>
  duration.value > 0 ? duration.value : (track.value?.duration ?? 0)
)
const displayCurrent = computed(() => currentTime.value)
const progress = computed(() =>
  displayDuration.value > 0 ? (displayCurrent.value / displayDuration.value) * 100 : 0
)

const liked = computed(() => (current.value ? library.isFavorite(current.value) : false))
function toggleLike(): void {
  if (current.value) void library.toggleFavorite(current.value)
}

function fmt(ms: number): string {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// 逐字歌词引擎
const lyricHost = ref<HTMLElement>()
const lyric = useLyricPlayer()
const hasLyric = ref(false)
// 每次加载自增，避免异步竞态（旧请求回来覆盖新歌）
let loadToken = 0

async function loadLyric(): Promise<void> {
  const token = ++loadToken
  if (!current.value) {
    lyric.clear()
    hasLyric.value = false
    return
  }
  try {
    const plain = JSON.parse(JSON.stringify(current.value))
    const ly = await api.player.lyric(plain)
    if (token !== loadToken) return
    const original = ly.char || ly.lrc
    if (original) {
      // 先露出宿主（visibility 而非 display:none），再加载，避免行高测成 0 叠行
      hasLyric.value = true
      await nextTick()
      if (token !== loadToken) return
      const roman = ly.chroma || ly.roma
      lyric.loadLyric(original, ly.trans, roman)
      await nextTick()
      if (token !== loadToken) return
      requestAnimationFrame(() => lyric.relayout())
      if (playing.value) lyric.play(currentTime.value)
      else lyric.seekMs(currentTime.value)
    } else {
      lyric.clear()
      hasLyric.value = false
    }
  } catch (e) {
    if (token !== loadToken) return
    console.error('[lyric] 获取失败', current.value?.type, current.value?.id, e)
    lyric.clear()
    hasLyric.value = false
  }
}

function applyAnnotationVisible(): void {
  const ly = settings.settings.lyrics
  lyric.setAnnotationVisible({
    translation: ly.showTranslation,
    romanization: ly.showRomanization
  })
}

onMounted(() => {
  lyricHost.value?.appendChild(lyric.element.value)
  applyAnnotationVisible()
  loadLyric()
})

watch(
  () => [settings.settings.lyrics.showTranslation, settings.settings.lyrics.showRomanization],
  () => applyAnnotationVisible()
)

// 切歌即重新拉取真实歌词
watch(current, () => loadLyric())

watch(playing, (p) => {
  if (!hasLyric.value) return
  if (p) lyric.play(currentTime.value)
  else lyric.pause()
})

// 歌词引擎 play(ms) 后自走；仅在跳变（seek）时重对齐，避免与音频漂移
let lastTime = 0
watch(currentTime, (t) => {
  if (hasLyric.value && current.value && Math.abs(t - lastTime) > 800) {
    if (playing.value) lyric.play(t)
    else lyric.seekMs(t)
  }
  lastTime = t
})

function seekByRatio(e: MouseEvent): void {
  if (!current.value || displayDuration.value <= 0) return
  const el = e.currentTarget as HTMLElement
  const rect = el.getBoundingClientRect()
  const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
  player.seek(ratio * displayDuration.value)
}
</script>

<template>
  <div class="player-page">
    <FluidBackground :colors="colors" />
    <div class="scrim" />

    <button class="close" title="收起" @click="router.back()">
      <AppIcon name="chevron-down" :size="24" />
    </button>

    <div class="content">
      <div class="left">
        <div class="cover">
          <img v-if="track?.cover" :src="track.cover" alt="" />
          <div v-else class="cover-empty"><AppIcon name="library" :size="48" /></div>
        </div>
        <div class="track-info">
          <div class="track-title ellipsis">{{ track?.title || '未在播放' }}</div>
          <div class="track-artist ellipsis">{{ track?.artist || '选一首歌开始' }}</div>
        </div>

        <div class="progress">
          <div class="bar" @click="seekByRatio">
            <div class="bar-fill" :style="{ width: progress + '%' }">
              <span class="thumb" />
            </div>
          </div>
          <div class="time">
            <span>{{ fmt(displayCurrent) }}</span>
            <span>-{{ fmt(displayDuration - displayCurrent) }}</span>
          </div>
        </div>

        <div class="controls">
          <button class="tbtn" title="上一首" @click="player.prev()">
            <AppIcon name="skip-back" :size="34" />
          </button>
          <button class="tbtn play" :title="playing ? '暂停' : '播放'" @click="player.toggle()">
            <AppIcon :name="playing ? 'pause' : 'play'" :size="40" />
          </button>
          <button class="tbtn" title="下一首" @click="player.next()">
            <AppIcon name="skip-forward" :size="34" />
          </button>
        </div>

        <div class="actions">
          <button
            class="abtn"
            :class="{ liked }"
            title="收藏"
            :disabled="!track"
            @click="toggleLike"
          >
            <AppIcon :name="liked ? 'heart-filled' : 'heart'" :size="20" />
          </button>
          <button class="abtn" title="音量"><AppIcon name="volume" :size="20" /></button>
          <button class="abtn" title="更多"><AppIcon name="more" :size="20" /></button>
        </div>
      </div>

      <div class="right">
        <div ref="lyricHost" class="lyric-host" :class="{ hidden: !hasLyric }" />
        <div v-if="!hasLyric" class="no-lyric">纯音乐，请欣赏</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.player-page {
  position: fixed;
  inset: 0;
  z-index: 2000;
  overflow: hidden;
  color: #fff;
}
.scrim {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    180deg,
    rgba(0, 0, 0, 0.26) 0%,
    rgba(0, 0, 0, 0.08) 42%,
    rgba(0, 0, 0, 0.44) 100%
  );
}
.close {
  position: absolute;
  top: 20px;
  right: 24px;
  z-index: 3;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  color: #fff;
  background: rgba(255, 255, 255, 0.16);
  transition: background 0.2s ease;
}
.close:hover {
  background: rgba(255, 255, 255, 0.26);
}

.content {
  position: relative;
  z-index: 2;
  display: flex;
  height: 100%;
  padding: 0 48px;
  gap: 40px;
}

.left {
  flex: none;
  width: 42%;
  max-width: 440px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 26px;
}
.cover {
  width: 300px;
  height: 300px;
  border-radius: 10px;
  overflow: hidden;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
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
  color: rgba(255, 255, 255, 0.5);
  background: rgba(255, 255, 255, 0.1);
}
.track-info {
  width: 300px;
  text-align: left;
}
.track-title {
  font-size: 26px;
  font-weight: 700;
}
.track-artist {
  margin-top: 4px;
  font-size: 18px;
  color: rgba(255, 255, 255, 0.86);
}

.progress {
  width: 300px;
}
.bar {
  height: 6px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.32);
  cursor: pointer;
}
.bar-fill {
  position: relative;
  height: 100%;
  border-radius: 999px;
  background: #fff;
}
.thumb {
  position: absolute;
  right: -6px;
  top: 50%;
  width: 13px;
  height: 13px;
  border-radius: 50%;
  background: #fff;
  transform: translateY(-50%);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
}
.time {
  display: flex;
  justify-content: space-between;
  margin-top: 8px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.62);
  font-variant-numeric: tabular-nums;
}

.controls {
  display: flex;
  align-items: center;
  gap: 36px;
}
.tbtn {
  display: flex;
  color: #fff;
  opacity: 0.92;
  transition:
    opacity 0.2s ease,
    transform 0.15s ease;
}
.tbtn:hover {
  opacity: 1;
}
.tbtn:active {
  transform: scale(0.92);
}
.play {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 66px;
  height: 66px;
}

.actions {
  display: flex;
  gap: 30px;
}
.abtn {
  display: flex;
  color: #fff;
  opacity: 0.82;
  transition: opacity 0.2s ease;
}
.abtn:hover {
  opacity: 1;
}
.abtn.liked {
  color: #ff5c7a;
  opacity: 1;
}
.abtn:disabled {
  opacity: 0.4;
  cursor: default;
}

/* 右：逐字歌词引擎挂载点 */
.right {
  position: relative;
  flex: 1;
  min-width: 0;
}
.lyric-host {
  width: 100%;
  height: 100%;
}
/* visibility:hidden 保留布局尺寸，避免 display:none 导致行高测 0 叠字 */
.lyric-host.hidden {
  visibility: hidden;
  pointer-events: none;
  position: absolute;
  inset: 0;
}
/* 主词与翻译/音译分层 */
.lyric-host :deep([data-role='line-normal']) {
  row-gap: 14px !important;
}
/* 汉字紧排：逐字音译用 absolute，不按拼音宽度撑开每个字 */
.lyric-host :deep([data-role='line-normal-text-word']) {
  --word-gap: 0px !important;
  position: relative;
  overflow: visible;
}
.lyric-host :deep([data-role='line-normal-text-word-roman']) {
  position: absolute !important;
  left: 50%;
  top: 100%;
  transform: translateX(-50%);
  width: max-content;
  max-width: none;
  white-space: nowrap;
  line-height: 1.15;
  pointer-events: none;
  font-weight: 400 !important;
}
.lyric-host :deep([data-role='line-normal-annotation-translation']),
.lyric-host :deep([data-role='line-normal-annotation-romanization']) {
  display: block !important;
  position: relative !important;
  line-height: 1.35;
  margin: 0;
  font-weight: 400 !important;
}
.no-lyric {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  font-size: 20px;
  color: rgba(255, 255, 255, 0.6);
}
</style>
