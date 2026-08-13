<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useRouter } from 'vue-router'
import { QUALITY_IDS, QUALITY_NAMES, type QualityId } from '@common'
import AppIcon from '../components/AppIcon.vue'
import AmllBackground from '../components/AmllBackground.vue'
import QualityDialog from '../components/QualityDialog.vue'
import { usePlayerStore } from '../stores/player'
import { useLibraryStore } from '../stores/library'
import { useLyricPlayer } from '../composables/useLyricPlayer'
import { useApi } from '../composables/useApi'
import { useSettingsStore } from '../stores/settings'
import { coverUrl } from '../utils/cover'

const router = useRouter()
const player = usePlayerStore()
const library = useLibraryStore()
const settings = useSettingsStore()
const api = useApi()
const { current, playing, currentTime, duration, volume, muted, playMode, quality } =
  storeToRefs(player)

const track = computed(() => current.value)
// 封面统一走主进程磁盘缓存协议（<img> 与背景渲染器同源）
const cover = computed(() => coverUrl(track.value?.cover))

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

// 播放模式（与 PlayerBar 同一套图标/文案）
const PLAY_MODE_META: Record<string, { icon: string; label: string }> = {
  listLoop: { icon: 'repeat', label: '列表循环' },
  singleLoop: { icon: 'repeat-one', label: '单曲循环' },
  random: { icon: 'shuffle', label: '随机播放' }
}
const modeMeta = computed(() => PLAY_MODE_META[playMode.value] ?? PLAY_MODE_META.listLoop)

// ============ 进度条（点击 + 拖拽；拖拽只动预览，松手才 seek，避免歌词引擎被连续跳变打断） ============
const progDragging = ref(false)
const progRatio = ref(0)
const shownProgress = computed(() => (progDragging.value ? progRatio.value * 100 : progress.value))
const shownCurrent = computed(() =>
  progDragging.value ? progRatio.value * displayDuration.value : displayCurrent.value
)

function ratioFromPointer(e: PointerEvent, el: HTMLElement): number {
  const rect = el.getBoundingClientRect()
  return Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
}
function onProgDown(e: PointerEvent): void {
  if (!current.value || displayDuration.value <= 0) return
  const el = e.currentTarget as HTMLElement
  el.setPointerCapture(e.pointerId)
  progDragging.value = true
  progRatio.value = ratioFromPointer(e, el)
}
function onProgMove(e: PointerEvent): void {
  if (!progDragging.value || e.buttons !== 1) return
  progRatio.value = ratioFromPointer(e, e.currentTarget as HTMLElement)
}
function onProgUp(): void {
  if (!progDragging.value) return
  progDragging.value = false
  player.seek(progRatio.value * displayDuration.value)
}

// ============ 音量条（与进度条同款轨道） ============
const shownVolume = computed(() => (muted.value ? 0 : volume.value))
const volIcon = computed(() => (muted.value || volume.value === 0 ? 'volume-mute' : 'volume'))
const volDragging = ref(false)
function onVolDown(e: PointerEvent): void {
  const el = e.currentTarget as HTMLElement
  el.setPointerCapture(e.pointerId)
  volDragging.value = true
  player.setVolume(ratioFromPointer(e, el))
}
function onVolMove(e: PointerEvent): void {
  if (!volDragging.value || e.buttons !== 1) return
  player.setVolume(ratioFromPointer(e, e.currentTarget as HTMLElement))
}
function onVolUp(): void {
  volDragging.value = false
}

// ============ 歌词面板 / 翻译开关 ============
const lyricVisible = ref(true)
async function toggleLyricPanel(): Promise<void> {
  lyricVisible.value = !lyricVisible.value
  if (lyricVisible.value) {
    // 面板 display:none 期间行高测为 0，重新可见后强制重排，避免叠行
    await nextTick()
    lyric.relayout()
  }
}
const showTrans = computed(() => settings.settings.lyrics.showTranslation)
function toggleTrans(): void {
  void settings.update({ lyrics: { showTranslation: !showTrans.value } })
}

// ============ 更多菜单（收藏 / 下载 / 播放音质） ============
const moreOpen = ref(false)
const showQualityDialog = ref(false)
const dialogItems = computed(() => (track.value ? [track.value] : []))
// 当前曲可用音质（高 → 低）
const qualityOptions = computed<QualityId[]>(() => {
  const t = track.value
  if (!t) return []
  return [...QUALITY_IDS].reverse().filter((id) => t.qualities[id])
})
function qualityLabel(id: QualityId): string {
  return track.value?.qualities[id]?.name || QUALITY_NAMES[id]
}
function pickQuality(id: QualityId): void {
  moreOpen.value = false
  if (id !== quality.value) void player.changeQuality(id)
}
function openDownload(): void {
  moreOpen.value = false
  showQualityDialog.value = true
}
function likeFromMenu(): void {
  toggleLike()
  moreOpen.value = false
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
      lyric.loadLyric(original, ly.trans, roman, {
        name: plain.title,
        singer: plain.artist ? [plain.artist] : []
      })
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
function applyLyricFont(): void {
  // 歌词字体：空则跟随软件字体（继承 body），否则用歌词专属字体
  lyric.setFontFamily(settings.settings.lyrics.font)
}

onMounted(() => {
  lyricHost.value?.appendChild(lyric.element.value)
  applyAnnotationVisible()
  applyLyricFont()
  loadLyric()
})

watch(
  () => [settings.settings.lyrics.showTranslation, settings.settings.lyrics.showRomanization],
  () => applyAnnotationVisible()
)
watch(
  () => settings.settings.lyrics.font,
  () => applyLyricFont()
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
</script>

<template>
  <!-- 挂到 body：字体大小设置靠 #app 的 zoom 整体缩放实现，全屏播放器
       （封面/控件/歌词字号）不应跟随界面字号档位变化 -->
  <Teleport to="body">
    <div class="player-page">
      <AmllBackground :cover="cover" />
      <div class="scrim" />

      <button class="close" title="收起" @click="router.back()">
        <AppIcon name="chevron-down" :size="24" />
      </button>

      <div class="content" :class="{ 'no-lyric-panel': !lyricVisible }">
        <div class="left">
          <div class="cover">
            <img v-if="cover" :src="cover" alt="" />
            <div v-else class="cover-empty"><AppIcon name="library" :size="40" /></div>
          </div>
          <div class="track-info">
            <div class="track-title ellipsis">{{ track?.title || '未在播放' }}</div>
            <div class="track-artist ellipsis">{{ track?.artist || '选一首歌开始' }}</div>
          </div>

          <div class="progress">
            <div
              class="bar"
              @pointerdown="onProgDown"
              @pointermove="onProgMove"
              @pointerup="onProgUp"
              @pointercancel="onProgUp"
            >
              <div class="bar-fill" :style="{ width: shownProgress + '%' }">
                <span class="thumb" />
              </div>
            </div>
            <div class="time">
              <span>{{ fmt(shownCurrent) }}</span>
              <span>-{{ fmt(Math.max(0, displayDuration - shownCurrent)) }}</span>
            </div>
          </div>

          <div class="controls">
            <button class="tbtn" title="上一首" @click="player.prev()">
              <AppIcon name="skip-back" :size="27" />
            </button>
            <button class="tbtn play" :title="playing ? '暂停' : '播放'" @click="player.toggle()">
              <AppIcon :name="playing ? 'pause' : 'play'" :size="33" />
            </button>
            <button class="tbtn" title="下一首" @click="player.next()">
              <AppIcon name="skip-forward" :size="27" />
            </button>
          </div>

          <div class="volume">
            <button class="vbtn" :title="muted ? '取消静音' : '静音'" @click="player.toggleMute()">
              <AppIcon :name="volIcon" :size="16" />
            </button>
            <div
              class="bar"
              @pointerdown="onVolDown"
              @pointermove="onVolMove"
              @pointerup="onVolUp"
              @pointercancel="onVolUp"
            >
              <div class="bar-fill" :style="{ width: shownVolume * 100 + '%' }">
                <span class="thumb" />
              </div>
            </div>
          </div>

          <div class="actions">
            <button class="abtn" :title="modeMeta.label" @click="player.cyclePlayMode()">
              <AppIcon :name="modeMeta.icon" :size="20" />
            </button>
            <button class="abtn" title="评论（开发中）" disabled>
              <AppIcon name="comment" :size="20" />
            </button>
            <button
              class="abtn"
              :class="{ off: !lyricVisible }"
              :title="lyricVisible ? '隐藏歌词' : '显示歌词'"
              @click="toggleLyricPanel"
            >
              <AppIcon name="lyric" :size="20" />
            </button>
            <button
              class="abtn"
              :class="{ off: !showTrans }"
              :title="showTrans ? '隐藏翻译' : '显示翻译'"
              @click="toggleTrans"
            >
              <AppIcon name="translate" :size="20" />
            </button>
            <div class="more-wrap">
              <button class="abtn" title="更多" @click="moreOpen = !moreOpen">
                <AppIcon name="more" :size="20" />
              </button>
              <template v-if="moreOpen">
                <div class="more-mask" @click="moreOpen = false" />
                <div class="more-menu">
                  <button class="mitem" :class="{ liked }" :disabled="!track" @click="likeFromMenu">
                    <AppIcon :name="liked ? 'heart-filled' : 'heart'" :size="16" />
                    <span>{{ liked ? '已收藏' : '收藏' }}</span>
                  </button>
                  <button class="mitem" :disabled="!track" @click="openDownload">
                    <AppIcon name="download" :size="16" />
                    <span>下载</span>
                  </button>
                  <template v-if="qualityOptions.length">
                    <div class="msep" />
                    <div class="mlabel">播放音质</div>
                    <button
                      v-for="q in qualityOptions"
                      :key="q"
                      class="mitem"
                      @click="pickQuality(q)"
                    >
                      <AppIcon
                        name="check"
                        :size="14"
                        class="qcheck"
                        :class="{ on: q === quality }"
                      />
                      <span>{{ qualityLabel(q) }}</span>
                    </button>
                  </template>
                </div>
              </template>
            </div>
          </div>
        </div>

        <div v-show="lyricVisible" class="right">
          <div ref="lyricHost" class="lyric-host" :class="{ hidden: !hasLyric }" />
          <div v-if="!hasLyric" class="no-lyric">纯音乐，请欣赏</div>
        </div>
      </div>

      <QualityDialog
        v-if="showQualityDialog"
        :items="dialogItems"
        @close="showQualityDialog = false"
      />
    </div>
  </Teleport>
</template>

<style scoped>
.player-page {
  position: fixed;
  inset: 0;
  z-index: 2000;
  overflow: hidden;
  border-radius: 10px;
  color: #fff;
  /* 网格渐变画布按音量留出 ~5% 透明度，给个深色底，
     免得主题背景图从缝隙里透出来；渲染失败时也退化成深色而非主题图 */
  background: #101013;
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
  gap: 48px;
}
/* 歌词面板隐藏时，左栏居中 */
.content.no-lyric-panel {
  justify-content: center;
}

/* 左栏：占左侧 42% 区域，内容（封面/信息/进度/控制，统一 240 宽）在区域内居中 */
.left {
  flex: none;
  width: 42%;
  max-width: 400px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 18px;
}
.cover {
  width: 240px;
  height: 240px;
  border-radius: 10px;
  overflow: hidden;
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.5);
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
  width: 240px;
  text-align: left;
}
.track-title {
  font-size: 21px;
  font-weight: 700;
}
.track-artist {
  margin-top: 3px;
  font-size: 14.5px;
  color: rgba(255, 255, 255, 0.86);
}

.progress {
  width: 240px;
}
.bar {
  height: 5px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.32);
  cursor: pointer;
  touch-action: none;
}
.bar-fill {
  position: relative;
  height: 100%;
  border-radius: 999px;
  background: #fff;
}
.thumb {
  position: absolute;
  right: -5px;
  top: 50%;
  width: 11px;
  height: 11px;
  border-radius: 50%;
  background: #fff;
  transform: translateY(-50%);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
}
.time {
  display: flex;
  justify-content: space-between;
  margin-top: 7px;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.62);
  font-variant-numeric: tabular-nums;
}

.controls {
  display: flex;
  align-items: center;
  gap: 38px;
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
  width: 54px;
  height: 54px;
}

/* 音量条：图标 + 轨道（轨道样式与进度条一致） */
.volume {
  width: 240px;
  display: flex;
  align-items: center;
  gap: 10px;
}
.vbtn {
  display: flex;
  color: #fff;
  opacity: 0.75;
  transition: opacity 0.2s ease;
}
.vbtn:hover {
  opacity: 1;
}
.volume .bar {
  flex: 1;
}

.actions {
  width: 240px;
  display: flex;
  align-items: center;
  justify-content: space-between;
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
.abtn.off {
  opacity: 0.42;
}
.abtn:disabled {
  opacity: 0.38;
  cursor: default;
}

/* 更多菜单：收藏/下载/播放音质 */
.more-wrap {
  position: relative;
  display: flex;
}
.more-mask {
  position: fixed;
  inset: 0;
  z-index: 1;
}
.more-menu {
  position: absolute;
  bottom: calc(100% + 12px);
  right: 0;
  z-index: 2;
  min-width: 176px;
  padding: 6px;
  border-radius: 10px;
  background: rgba(34, 34, 36, 0.92);
  backdrop-filter: blur(24px);
  box-shadow: 0 10px 34px rgba(0, 0, 0, 0.45);
}
.mitem {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 8px 10px;
  border-radius: 6px;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.92);
  transition: background 0.15s ease;
}
.mitem:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.1);
}
.mitem:disabled {
  opacity: 0.45;
  cursor: default;
}
.mitem.liked {
  color: #ff5c7a;
}
.msep {
  height: 1px;
  margin: 5px 8px;
  background: rgba(255, 255, 255, 0.14);
}
.mlabel {
  padding: 4px 10px 2px;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.5);
}
.qcheck {
  opacity: 0;
}
.qcheck.on {
  opacity: 1;
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
/*
 * 逐字音译的溢出与行高问题已在引擎侧修掉（annotation-row 改 width:max-content + min-height:auto，
 * 见 src/renderer/src/lyric/.../syllable/index.module.scss 的 [vendor patch]），
 * 这里只保留纯外观项。切勿再压 line-height——引擎按 span.clientHeight 生成擦除 mask，
 * 盒子矮一截就会把 g/p/y 的下降部连同 mask 一起切掉。
 */
.lyric-host :deep([data-role='line-normal-text-word-roman']) {
  white-space: nowrap;
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
