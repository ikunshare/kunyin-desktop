<script setup lang="ts">
import SleepTimerDialog from '../components/SleepTimerDialog.vue'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useRouter } from 'vue-router'
import { QUALITY_IDS, QUALITY_NAMES, blockedQualityIds, type QualityId } from '@common'
import AppIcon from '../components/AppIcon.vue'
import AmllBackground from '../components/AmllBackground.vue'
import CommentDialog from '../components/CommentDialog.vue'
import QualityDialog from '../components/QualityDialog.vue'
import PlaybackRatePopover from '../components/PlaybackRatePopover.vue'
import SoundEffectDialog from '../components/SoundEffectDialog.vue'
import { usePlayerStore } from '../stores/player'
import { useLibraryStore } from '../stores/library'
import { useLyricPlayer } from '../composables/useLyricPlayer'
import { useApi } from '../composables/useApi'
import { useSettingsStore } from '../stores/settings'
import { needsGraph } from '../audio/soundEffect'
import { coverUrl } from '../utils/cover'

const router = useRouter()
const player = usePlayerStore()
const library = useLibraryStore()
const settings = useSettingsStore()
const api = useApi()
const { current, playing, currentTime, duration, volume, muted, playMode, quality, playbackRate } =
  storeToRefs(player)

const track = computed(() => current.value)
const playerFullscreen = ref(false)
let unsubscribeFullscreen: (() => void) | null = null

/**
 * Electron 在部分 Windows 环境不会稳定触发 enter-full-screen；除主进程状态外，
 * 再用当前视口是否覆盖屏幕工作区兜底，保证播放页能拿到真实的全屏布局状态。
 */
function viewportCoversScreen(): boolean {
  const tolerance = 8
  return (
    window.innerWidth >= window.screen.availWidth - tolerance &&
    window.innerHeight >= window.screen.availHeight - tolerance
  )
}

function applyPlayerFullscreen(nativeFullscreen: boolean): void {
  playerFullscreen.value = nativeFullscreen || viewportCoversScreen()
}

function syncPlayerFullscreen(): void {
  void api.window.fullscreen().then(applyPlayerFullscreen)
}
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
  order: { icon: 'list', label: '顺序播放' },
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

// ============ 评论弹窗 ============
const showComment = ref(false)
const showTrans = computed(() => settings.settings.lyrics.showTranslation)
function toggleTrans(): void {
  void settings.update({ lyrics: { showTranslation: !showTrans.value } })
}

// ============ 音效弹窗（均衡器/混响/环绕/升降调，与 LX 一样挂在播放页而非设置页） ============
const showSoundEffect = ref(false)
const soundEffectButton = ref<HTMLButtonElement>()
/** 有任一项偏离默认值就高亮按钮（判据与「要不要建处理图」是同一个） */
const soundEffectOn = computed(() => needsGraph(settings.settings.player.soundEffect))
function closeSoundEffect(): void {
  showSoundEffect.value = false
  void nextTick(() => soundEffectButton.value?.focus())
}

// ============ 更多菜单（收藏 / 下载 / 播放音质） ============
const moreOpen = ref(false)
const showSleepTimer = ref(false)
const moreButton = ref<HTMLButtonElement>()
function openSleepTimer(): void {
  moreOpen.value = false
  showSleepTimer.value = true
}
function closeSleepTimer(): void {
  showSleepTimer.value = false
  void nextTick(() => moreButton.value?.focus())
}
const showQualityDialog = ref(false)
const dialogItems = computed(() => (track.value ? [track.value] : []))
// 当前曲可用音质（高 → 低；被屏蔽的 AI 音质不列出）
const qualityOptions = computed<QualityId[]>(() => {
  const t = track.value
  if (!t) return []
  const blocked = blockedQualityIds(settings.settings)
  return [...QUALITY_IDS].reverse().filter((id) => t.qualities[id] && !blocked.includes(id))
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
/** 制作人信息；歌词只有幕后名单、没有唱词时，由「纯音乐」占位块直接列出 */
const lyricCredits = lyric.credits
const hasLyric = ref(false)
const hasTranslation = ref(false)
// 每次加载自增，避免异步竞态（旧请求回来覆盖新歌）
let loadToken = 0

/** 忽略 LRC 时间戳/元数据标签后，判断翻译轨是否含有实际文本。 */
function hasLyricText(raw: string): boolean {
  return raw.split(/\r?\n/).some(
    (line) =>
      line
        .replace(/\[[^\]]*]/g, '')
        .replace(/<[^>]*>/g, '')
        .trim().length > 0
  )
}

async function loadLyric(): Promise<void> {
  const token = ++loadToken
  hasTranslation.value = false
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
      hasTranslation.value = hasLyricText(ly.trans)
      // 先露出宿主（visibility 而非 display:none），再加载，避免行高测成 0 叠行
      hasLyric.value = true
      await nextTick()
      if (token !== loadToken) return
      const roman = ly.chroma || ly.roma
      const hasLines = lyric.loadLyric(original, ly.trans, roman, {
        name: plain.title,
        singer: plain.artist ? [plain.artist] : []
      })
      if (!hasLines) {
        // 只有制作人信息、没有唱词：按纯音乐处理，credits 留在 lyric.credits 里由占位块展示
        hasLyric.value = false
        hasTranslation.value = false
        return
      }
      await nextTick()
      if (token !== loadToken) return
      requestAnimationFrame(() => lyric.relayout())
      if (playing.value) lyric.play(currentTime.value)
      else lyric.seekMs(currentTime.value)
    } else {
      lyric.clear()
      hasLyric.value = false
      hasTranslation.value = false
    }
  } catch (e) {
    if (token !== loadToken) return
    console.error('[lyric] 获取失败', current.value?.type, current.value?.id, e)
    lyric.clear()
    hasLyric.value = false
    hasTranslation.value = false
  }
}

/**
 * 「这是一次 seek 而不是自然推进」的判据（毫秒）。
 *
 * timeupdate 约 4 次/秒，每次推进 ≈ 250ms × 倍速，所以阈值必须跟着倍速放大：
 * 钉死 800ms 的话，2× 下的正常推进（约 500ms，卡一帧就破 800）会被当成 seek，
 * 歌词每帧重新对齐一次，逐字动画不停重启。
 */
const realignThreshold = computed(() => 800 * playbackRate.value)

/**
 * 点击歌词行 → 跳到该行开头。
 *
 * 只驱动音频：歌词引擎的重对齐统一交给下方 currentTime 的跳变 watcher，
 * 避免这里和 watcher 各 play 一次导致逐字动画重启两遍。
 * 但 lastTime 必须在这里先对齐——点击的行离当前位置可能不到重对齐阈值，
 * watcher 会跳过重对齐，引擎就还停在原处，得手动补一次。
 */
function seekToLyricLine(ms: number): void {
  if (!current.value) return
  // displayDuration 与 lyric 时间同为毫秒；时长未知时不做上限裁剪
  const total = displayDuration.value
  const target = Math.max(0, total > 0 ? Math.min(ms, total) : ms)
  player.seek(target)
  if (hasLyric.value && Math.abs(target - lastTime) <= realignThreshold.value) {
    if (playing.value) lyric.play(target)
    else lyric.seekMs(target)
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

let unsubscribeLineSeek: (() => void) | null = null

onMounted(() => {
  syncPlayerFullscreen()
  unsubscribeFullscreen = api.window.onFullscreenChange(applyPlayerFullscreen)
  window.addEventListener('resize', syncPlayerFullscreen)
  lyricHost.value?.appendChild(lyric.element.value)
  // 制作人信息作为歌词流的收尾展示（跟着最后一行滚动）
  lyric.setCreditsVisible(true)
  // 点击歌词行跳到该行时间；引擎侧重对齐交给下面的 currentTime 跳变 watcher
  unsubscribeLineSeek = lyric.onLineSeek(seekToLyricLine)
  applyAnnotationVisible()
  applyLyricFont()
  // 引擎自走墙钟时钟，倍速必须同步过去，否则歌词按 1× 推进、越放越落后
  lyric.setPlaybackRate(playbackRate.value)
  loadLyric()
})

onUnmounted(() => {
  unsubscribeFullscreen?.()
  unsubscribeLineSeek?.()
  window.removeEventListener('resize', syncPlayerFullscreen)
})

watch(
  () => [settings.settings.lyrics.showTranslation, settings.settings.lyrics.showRomanization],
  () => applyAnnotationVisible()
)
watch(
  () => settings.settings.lyrics.font,
  () => applyLyricFont()
)
// 倍速跟着 <audio> 的真值走（含滑杆拖动中的试听），不是设置里的值
watch(playbackRate, (rate) => lyric.setPlaybackRate(rate))

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
  if (hasLyric.value && current.value && Math.abs(t - lastTime) > realignThreshold.value) {
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
    <div class="player-page" :class="{ fullscreen: playerFullscreen }">
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
            <PlaybackRatePopover />
            <button
              ref="soundEffectButton"
              class="abtn"
              :class="{ on: soundEffectOn }"
              title="音效"
              @click="showSoundEffect = true"
            >
              <AppIcon name="equalizer" :size="20" />
            </button>
            <button class="abtn" title="评论" @click="showComment = true">
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
              v-if="hasTranslation"
              class="abtn"
              :class="{ off: !showTrans }"
              :title="showTrans ? '隐藏翻译' : '显示翻译'"
              @click="toggleTrans"
            >
              <AppIcon name="translate" :size="20" />
            </button>
            <div class="more-wrap">
              <button
                ref="moreButton"
                class="abtn"
                title="更多"
                :aria-expanded="moreOpen"
                @click="moreOpen = !moreOpen"
              >
                <AppIcon name="more" :size="20" />
              </button>
              <template v-if="moreOpen">
                <div class="more-mask" @click="moreOpen = false" />
                <div class="more-menu">
                  <button class="mitem sleep-menu-item" @click="openSleepTimer">
                    <AppIcon name="clock" :size="16" />
                    <span
                      >定时暂停<small v-if="player.sleepRemaining || player.stopAfterTrack">{{
                        player.stopAfterTrack
                          ? '本曲播完暂停'
                          : `${Math.ceil(player.sleepRemaining / 60)} 分钟后暂停`
                      }}</small></span
                    >
                  </button>
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
          <div v-if="!hasLyric" class="no-lyric">
            <div class="no-lyric-title">纯音乐，请欣赏</div>
            <div v-if="lyricCredits.length" class="no-lyric-credits">
              <div v-for="item in lyricCredits" :key="item.role" class="no-lyric-credits-row">
                <span class="no-lyric-credits-role">{{ item.role }}</span>
                <span class="no-lyric-credits-names">{{ item.names.join(' · ') }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <CommentDialog v-if="showComment" :track="track" @close="showComment = false" />
      <SleepTimerDialog v-if="showSleepTimer" @close="closeSleepTimer" />
      <SoundEffectDialog v-if="showSoundEffect" @close="closeSoundEffect" />

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
  --player-panel-width: 240px;
  --player-cover-size: 240px;
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
/*
 * 无边框窗口只能靠 app-region 拖动。本页 Teleport 到 body 且铺满窗口，
 * 会把 AppToolbar/AppAside 上唯一的拖拽区整块盖掉——那时窗口彻底拖不动。
 * 因此让铺满整页的遮罩层可拖，再由下面一条规则把所有交互区域显式排除。
 *
 * 拖拽区是纯几何计算、与绘制层级无关：Chromium 按 DOM 顺序收集每个
 * drag / no-drag 盒子的矩形，Electron 依序做并集 / 差集。app-region 会被后代
 * 继承，所以 drag 只能挂在 .scrim 这种没有后代、且排在所有交互元素之前的
 * 元素上。若挂在 .player-page，排在 .close 之后的 .content 会继承 drag、把整页
 * 矩形再并回去，返回键中没被 .right 面板（no-drag）盖到的右侧就变回拖拽区，
 * 点击被系统当成拖窗口吃掉。
 */
.scrim {
  position: absolute;
  inset: 0;
  -webkit-app-region: drag;
  background: linear-gradient(
    180deg,
    rgba(0, 0, 0, 0.26) 0%,
    rgba(0, 0, 0, 0.08) 42%,
    rgba(0, 0, 0, 0.44) 100%
  );
}
/* 交互区域从拖拽区里挖掉；按容器排除即可覆盖其中所有按钮/滑块/菜单 */
.close,
.progress,
.controls,
.volume,
.actions,
.right {
  -webkit-app-region: no-drag;
}
.close {
  /* 可见圆底直径 / 圆外四周额外的命中区宽度 */
  --close-size: 40px;
  --close-slop: 12px;
  position: absolute;
  top: calc(20px - var(--close-slop));
  right: calc(24px - var(--close-slop));
  z-index: 3;
  display: flex;
  align-items: center;
  justify-content: center;
  width: calc(var(--close-size) + var(--close-slop) * 2);
  height: calc(var(--close-size) + var(--close-slop) * 2);
  color: #fff;
}
/*
 * 可见圆底画在伪元素上，按钮盒子本身比圆大一圈（--close-slop）：整盒都是命中区，
 * 视觉上仍是原来大小的圆。悬停高亮跟随整盒，点到圆外一圈时也有反馈。
 */
.close::before {
  content: '';
  position: absolute;
  inset: var(--close-slop);
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.16);
  transition: background 0.2s ease;
}
.close:hover::before {
  background: rgba(255, 255, 255, 0.26);
}
.close :deep(.app-icon) {
  /* 抬到伪元素圆底之上 */
  position: relative;
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
  width: var(--player-cover-size);
  height: var(--player-cover-size);
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
  width: var(--player-panel-width);
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
  width: var(--player-panel-width);
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
  width: var(--player-panel-width);
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
  width: var(--player-panel-width);
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
/* 音效已偏离默认：用主色点亮，和播放速度弹层的高亮同一套 */
.abtn.on {
  opacity: 1;
  color: #8be0a4;
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
.sleep-menu-item small {
  display: block;
  margin-top: 4px;
  font-size: 11px;
  opacity: 0.65;
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
/* 主词与翻译/音译分层；点击整行跳到该行时间（hover 高亮由引擎自带） */
.lyric-host :deep([data-role='line-normal']) {
  row-gap: 14px !important;
  cursor: pointer;
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
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 22px;
  height: 100%;
  color: rgba(255, 255, 255, 0.6);
}
.no-lyric-title {
  font-size: 20px;
}
/*
 * 歌词只有幕后名单时（纯器乐曲常见），名单在「纯音乐」下方居中列出。
 * 字号/透明度与歌词末尾的 .lyric-credits 保持同一档，只是居中排。
 * 名单可能很长（乐队/录音棚一行十几个名字），允许行内换行并整块可滚动，滚动条隐藏。
 */
.no-lyric-credits {
  display: flex;
  flex-direction: column;
  gap: 5px;
  max-height: 60%;
  max-width: 100%;
  overflow-y: auto;
  scrollbar-width: none;
  font-size: 12.5px;
  line-height: 1.45;
  text-align: center;
}
.no-lyric-credits::-webkit-scrollbar {
  display: none;
}
.no-lyric-credits-row {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0 10px;
}
.no-lyric-credits-role {
  flex: none;
  color: rgba(255, 255, 255, 0.34);
}
.no-lyric-credits-names {
  min-width: 0;
  color: rgba(255, 255, 255, 0.5);
}

/*
 * 制作人信息：由歌词引擎渲染在末行之后的 footer 里（跟着歌词一起滚动），
 * 所以要用 :deep 穿透 scoped。与歌词同左对齐，字号小一档、压低不透明度，
 * 读起来是「附注」而不是又一句唱词——Apple Music 的处理方式。
 */
.lyric-host :deep(.lyric-credits) {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 4px 0 8px;
  font-size: 12.5px;
  line-height: 1.45;
}
.lyric-host :deep(.lyric-credits-row) {
  display: flex;
  gap: 10px;
}
.lyric-host :deep(.lyric-credits-role) {
  flex: none;
  color: rgba(255, 255, 255, 0.34);
}
.lyric-host :deep(.lyric-credits-names) {
  min-width: 0;
  color: rgba(255, 255, 255, 0.5);
}

/*
 * 播放页 Teleport 到 body，不在 #app 内；全屏圆角和尺度必须在这里单独处理。
 * 窗口模式继续使用上面的 240px 紧凑布局，全屏才按视口有限放大，避免低分辨率溢出。
 */
.player-page.fullscreen {
  --player-panel-width: clamp(300px, 19vw, 380px);
  --player-cover-size: clamp(280px, min(19vw, 31vh), 380px);
  border-radius: 0;
}

.player-page.fullscreen .content {
  padding-inline: clamp(56px, 4vw, 96px);
  gap: clamp(56px, 5vw, 112px);
}

.player-page.fullscreen .left {
  width: clamp(420px, 32vw, 560px);
  max-width: none;
  gap: clamp(18px, 1.6vh, 24px);
}

/* 歌词隐藏后几何中心略显右重，做一档随视口变化的光学左移补偿。 */
.player-page.fullscreen .content.no-lyric-panel .left {
  transform: translateX(clamp(-28px, -1vw, -16px));
}

.player-page.fullscreen .track-title {
  font-size: clamp(23px, 1.25vw, 28px);
}

.player-page.fullscreen .track-artist {
  margin-top: 5px;
  font-size: clamp(15px, 0.82vw, 18px);
}

.player-page.fullscreen .bar {
  height: 7px;
}

.player-page.fullscreen .thumb {
  right: -7px;
  width: 15px;
  height: 15px;
}

.player-page.fullscreen .time {
  margin-top: 9px;
  font-size: 13px;
}

.player-page.fullscreen .controls {
  gap: clamp(42px, 3vw, 58px);
}

.player-page.fullscreen .tbtn {
  align-items: center;
  justify-content: center;
  width: 52px;
  height: 52px;
}

.player-page.fullscreen .tbtn:not(.play) :deep(.app-icon) {
  width: 34px;
  height: 34px;
}

.player-page.fullscreen .play {
  width: 72px;
  height: 72px;
}

.player-page.fullscreen .play :deep(.app-icon) {
  width: 43px;
  height: 43px;
}

.player-page.fullscreen .volume {
  gap: 14px;
}

.player-page.fullscreen .vbtn :deep(.app-icon) {
  width: 22px;
  height: 22px;
}

.player-page.fullscreen .actions :deep(.app-icon) {
  width: 25px;
  height: 25px;
}

.player-page.fullscreen .close {
  --close-size: 48px;
  top: calc(26px - var(--close-slop));
  right: calc(30px - var(--close-slop));
}

.player-page.fullscreen .close :deep(.app-icon) {
  width: 28px;
  height: 28px;
}

.player-page.fullscreen .lyric-host :deep(.lyric-credits),
.player-page.fullscreen .no-lyric-credits {
  gap: 6px;
  font-size: 14px;
}
</style>
