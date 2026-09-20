<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { DEFAULT_SETTINGS, type AppSettings } from '@common'
import { useSettingsStore } from '../../stores/settings'
import { usePlayerStore } from '../../stores/player'
import { useApi } from '../../composables/useApi'
import { listSystemFonts } from '../../composables/useFonts'
import BaseBtn from '../../components/BaseBtn.vue'
import BaseCheckbox from '../../components/BaseCheckbox.vue'
import BaseSelect from '../../components/BaseSelect.vue'

const store = useSettingsStore()
const player = usePlayerStore()
const { settings } = storeToRefs(store)
const api = useApi()

const fontList = ref<{ id: string; label: string }[]>([{ id: '', label: '跟随歌词字体' }])

onMounted(async () => {
  const platform = await api.app.getPlatform()
  const fonts = await listSystemFonts(platform)
  fontList.value = [
    { id: '', label: '跟随歌词字体' },
    ...fonts.map((font) => ({ id: font, label: font.replace(/(^"|"$)/g, '') }))
  ]
})

const previewStyle = computed<Record<string, string>>(() => {
  const s = settings.value.lyrics
  return {
    background: `rgba(9, 12, 11, ${Math.max(0, Math.min(0.8, s.desktopBgOpacity))})`,
    fontFamily: s.desktopFont ? `"${s.desktopFont}"` : 'inherit',
    fontSize: `${Math.max(16, Math.min(34, s.desktopFontSize * 0.72))}px`,
    textAlign: s.desktopAlign,
    opacity: String(Math.max(0.06, Math.min(1, s.desktopOpacity / 100))),
    '--preview-normal': s.desktopColorNormal,
    '--preview-active': s.desktopColorActive
  }
})

function updateLyrics(patch: Partial<AppSettings['lyrics']>): void {
  void store.update({ lyrics: patch })
}

function toggleDesktopLyric(value: boolean | string | number): void {
  void api.desktopLyric.toggle(Boolean(value))
}

function toggleAudioVisualization(value: boolean | string | number): void {
  const enabled = Boolean(value)
  if (enabled) player.enableAudioSpectrum()
  updateLyrics({ desktopAudioVisualization: enabled })
}

function setNumber(
  key: keyof AppSettings['lyrics'],
  event: Event,
  min: number,
  max: number,
  scale = 1
): void {
  const raw = Number((event.target as HTMLInputElement).value) / scale
  const value = Math.max(min, Math.min(max, Number.isFinite(raw) ? raw : min))
  updateLyrics({ [key]: value } as Partial<AppSettings['lyrics']>)
}

function setColor(key: 'desktopColorNormal' | 'desktopColorActive', event: Event): void {
  updateLyrics({ [key]: (event.target as HTMLInputElement).value })
}

function resetColors(): void {
  const defaults = DEFAULT_SETTINGS.lyrics
  updateLyrics({
    desktopColorNormal: defaults.desktopColorNormal,
    desktopColorActive: defaults.desktopColorActive
  })
}

function resetWindow(): void {
  updateLyrics({
    desktopX: null,
    desktopY: null,
    desktopWidth: DEFAULT_SETTINGS.lyrics.desktopWidth,
    desktopHeight: DEFAULT_SETTINGS.lyrics.desktopHeight
  })
}

function resetAll(): void {
  const {
    showTranslation: _showTranslation,
    showRomanization: _showRomanization,
    fontSize: _fontSize,
    font: _font,
    ...desktopDefaults
  } = DEFAULT_SETTINGS.lyrics
  void store.update({ lyrics: desktopDefaults })
}
</script>

<template>
  <dt id="desktop_lyric">桌面歌词设置</dt>

  <dd class="master-card">
    <div class="master-row">
      <div>
        <BaseCheckbox
          id="setting_dl_enable"
          :model-value="settings.lyrics.desktopEnabled"
          label="启用桌面歌词"
          @update:model-value="toggleDesktopLyric"
        />
        <p>悬浮显示当前歌词，所有样式修改都会立即同步到歌词窗口。</p>
      </div>
      <span class="status" :class="{ on: settings.lyrics.desktopEnabled }">
        {{ settings.lyrics.desktopEnabled ? '正在显示' : '已关闭' }}
      </span>
    </div>
  </dd>

  <dd>
    <h3 id="desktop_lyric_window">窗口行为</h3>
    <div class="option-grid">
      <div class="option-item">
        <BaseCheckbox
          id="setting_dl_lock"
          :model-value="settings.lyrics.desktopLocked"
          label="锁定并允许点击穿透"
          @update:model-value="updateLyrics({ desktopLocked: $event as boolean })"
        />
        <small>锁定后请从此处解锁。</small>
      </div>
      <div class="option-item">
        <BaseCheckbox
          id="setting_dl_always_top"
          :model-value="settings.lyrics.desktopAlwaysOnTop"
          label="窗口置顶"
          @update:model-value="updateLyrics({ desktopAlwaysOnTop: $event as boolean })"
        />
        <small>保持歌词位于普通窗口上方。</small>
      </div>
      <div class="option-item">
        <BaseCheckbox
          id="setting_dl_always_top_loop"
          :model-value="settings.lyrics.desktopAlwaysOnTopLoop"
          :disabled="!settings.lyrics.desktopAlwaysOnTop"
          label="自动刷新置顶"
          @update:model-value="updateLyrics({ desktopAlwaysOnTopLoop: $event as boolean })"
        />
        <small>适用于会抢占置顶层级的程序。</small>
      </div>
      <div class="option-item">
        <BaseCheckbox
          id="setting_dl_taskbar"
          :model-value="settings.lyrics.desktopShowTaskbar"
          label="在任务栏显示"
          @update:model-value="updateLyrics({ desktopShowTaskbar: $event as boolean })"
        />
        <small>把桌面歌词作为独立窗口显示。</small>
      </div>
      <div class="option-item">
        <BaseCheckbox
          id="setting_dl_fullscreen_hide"
          :model-value="settings.lyrics.desktopFullscreenHide"
          label="主窗口全屏时隐藏"
          @update:model-value="updateLyrics({ desktopFullscreenHide: $event as boolean })"
        />
        <small>离开全屏后自动恢复。</small>
      </div>
      <div class="option-item">
        <BaseCheckbox
          id="setting_dl_pause_hide"
          :model-value="settings.lyrics.desktopPauseHide"
          label="暂停时淡出"
          @update:model-value="updateLyrics({ desktopPauseHide: $event as boolean })"
        />
        <small>鼠标移入未锁定窗口可临时显示。</small>
      </div>
      <div class="option-item">
        <BaseCheckbox
          id="setting_dl_lock_screen"
          :model-value="settings.lyrics.desktopLockScreen"
          label="限制在屏幕范围内"
          @update:model-value="updateLyrics({ desktopLockScreen: $event as boolean })"
        />
        <small>移动或缩放时不超出当前显示器。</small>
      </div>
      <div class="option-item">
        <BaseCheckbox
          id="setting_dl_hover_hide"
          :model-value="settings.lyrics.desktopHoverHide"
          label="鼠标划过时淡出"
          @update:model-value="updateLyrics({ desktopHoverHide: $event as boolean })"
        />
        <small>避免歌词挡住下方内容。</small>
      </div>
      <div class="option-item">
        <BaseCheckbox
          id="setting_dl_visualizer"
          :model-value="settings.lyrics.desktopAudioVisualization"
          label="显示实时音频频谱"
          @update:model-value="toggleAudioVisualization"
        />
        <small>由播放器的 Web Audio 频率数据实时驱动。</small>
      </div>
    </div>
  </dd>

  <dd>
    <h3 id="desktop_lyric_layout">排版与滚动</h3>
    <div class="setting-group">
      <span class="group-label">歌词方向</span>
      <div>
        <BaseCheckbox
          id="setting_dl_direction_horizontal"
          class="gap-left"
          name="setting_dl_direction"
          need
          value="horizontal"
          :model-value="settings.lyrics.desktopDirection"
          label="横向"
          @update:model-value="updateLyrics({ desktopDirection: $event as 'horizontal' })"
        />
        <BaseCheckbox
          id="setting_dl_direction_vertical"
          class="gap-left"
          name="setting_dl_direction"
          need
          value="vertical"
          :model-value="settings.lyrics.desktopDirection"
          label="竖排"
          @update:model-value="updateLyrics({ desktopDirection: $event as 'vertical' })"
        />
      </div>
    </div>
    <div class="setting-group">
      <span class="group-label">滚动位置</span>
      <div>
        <BaseCheckbox
          id="setting_dl_scroll_top"
          class="gap-left"
          name="setting_dl_scroll"
          need
          value="top"
          :model-value="settings.lyrics.desktopScrollAlign"
          label="靠上"
          @update:model-value="updateLyrics({ desktopScrollAlign: $event as 'top' })"
        />
        <BaseCheckbox
          id="setting_dl_scroll_center"
          class="gap-left"
          name="setting_dl_scroll"
          need
          value="center"
          :model-value="settings.lyrics.desktopScrollAlign"
          label="居中"
          @update:model-value="updateLyrics({ desktopScrollAlign: $event as 'center' })"
        />
      </div>
    </div>
    <div class="setting-group">
      <span class="group-label">文字对齐</span>
      <div>
        <BaseCheckbox
          v-for="item in [
            { id: 'left', label: '左对齐' },
            { id: 'center', label: '居中' },
            { id: 'right', label: '右对齐' }
          ]"
          :id="`setting_dl_align_${item.id}`"
          :key="item.id"
          class="gap-left"
          name="setting_dl_align"
          need
          :value="item.id"
          :model-value="settings.lyrics.desktopAlign"
          :label="item.label"
          @update:model-value="
            updateLyrics({ desktopAlign: $event as 'left' | 'center' | 'right' })
          "
        />
      </div>
    </div>
    <div class="option-grid compact">
      <BaseCheckbox
        id="setting_dl_delay_scroll"
        :model-value="settings.lyrics.desktopDelayScroll"
        label="舒缓延迟滚动"
        @update:model-value="updateLyrics({ desktopDelayScroll: $event as boolean })"
      />
      <BaseCheckbox
        id="setting_dl_ellipsis"
        :model-value="settings.lyrics.desktopEllipsis"
        label="长歌词只显示一行"
        @update:model-value="updateLyrics({ desktopEllipsis: $event as boolean })"
      />
      <BaseCheckbox
        id="setting_dl_zoom"
        :model-value="settings.lyrics.desktopZoomActive"
        label="放大当前播放行"
        @update:model-value="updateLyrics({ desktopZoomActive: $event as boolean })"
      />
    </div>
  </dd>

  <dd>
    <h3 id="desktop_lyric_typography">字体与层级</h3>
    <div class="font-row">
      <span class="group-label">桌面歌词字体</span>
      <BaseSelect
        :model-value="settings.lyrics.desktopFont"
        :list="fontList"
        @update:model-value="updateLyrics({ desktopFont: $event })"
      />
    </div>
    <div class="range-grid">
      <label class="range-item">
        <span
          >字号 <b>{{ settings.lyrics.desktopFontSize }} px</b></span
        >
        <input
          type="range"
          min="10"
          max="80"
          step="1"
          :value="settings.lyrics.desktopFontSize"
          @change="setNumber('desktopFontSize', $event, 10, 80)"
        />
      </label>
      <label class="range-item">
        <span
          >歌词间距 <b>{{ settings.lyrics.desktopLineGap }} px</b></span
        >
        <input
          type="range"
          min="0"
          max="72"
          step="1"
          :value="settings.lyrics.desktopLineGap"
          @change="setNumber('desktopLineGap', $event, 0, 72)"
        />
      </label>
      <label class="range-item">
        <span
          >歌词不透明度 <b>{{ settings.lyrics.desktopOpacity }}%</b></span
        >
        <input
          type="range"
          min="6"
          max="100"
          step="2"
          :value="settings.lyrics.desktopOpacity"
          @change="setNumber('desktopOpacity', $event, 6, 100)"
        />
      </label>
      <label class="range-item">
        <span
          >背景不透明度 <b>{{ Math.round(settings.lyrics.desktopBgOpacity * 100) }}%</b></span
        >
        <input
          type="range"
          min="0"
          max="80"
          step="2"
          :value="settings.lyrics.desktopBgOpacity * 100"
          @change="setNumber('desktopBgOpacity', $event, 0, 0.8, 100)"
        />
      </label>
    </div>
    <div class="option-grid compact weight-options">
      <BaseCheckbox
        id="setting_dl_bold_syllable"
        :model-value="settings.lyrics.desktopBoldSyllable"
        label="加粗逐字歌词"
        @update:model-value="updateLyrics({ desktopBoldSyllable: $event as boolean })"
      />
      <BaseCheckbox
        id="setting_dl_bold_line"
        :model-value="settings.lyrics.desktopBoldLine"
        label="加粗逐行歌词"
        @update:model-value="updateLyrics({ desktopBoldLine: $event as boolean })"
      />
      <BaseCheckbox
        id="setting_dl_bold_extended"
        :model-value="settings.lyrics.desktopBoldExtended"
        label="加粗翻译和音译"
        @update:model-value="updateLyrics({ desktopBoldExtended: $event as boolean })"
      />
    </div>
  </dd>

  <dd>
    <h3 id="desktop_lyric_color">歌词颜色</h3>
    <div class="color-grid">
      <label class="color-item">
        <input
          type="color"
          :value="settings.lyrics.desktopColorNormal"
          @input="setColor('desktopColorNormal', $event)"
        />
        <span>未播放歌词</span>
        <code>{{ settings.lyrics.desktopColorNormal }}</code>
      </label>
      <label class="color-item">
        <input
          type="color"
          :value="settings.lyrics.desktopColorActive"
          @input="setColor('desktopColorActive', $event)"
        />
        <span>已播放歌词</span>
        <code>{{ settings.lyrics.desktopColorActive }}</code>
      </label>
    </div>

    <div class="lyric-preview" :style="previewStyle">
      <span class="preview-active">坤音把旋律留在此刻</span>
      <span class="preview-normal">下一句歌词将在这里亮起</span>
    </div>

    <div class="button-row">
      <BaseBtn min outline @click="resetColors">恢复默认颜色</BaseBtn>
    </div>
  </dd>

  <dd>
    <h3 id="desktop_lyric_reset">重置</h3>
    <div class="reset-row">
      <div>
        <strong>窗口位置与尺寸</strong>
        <p>恢复为屏幕底部居中的 640 × 180 窗口。</p>
      </div>
      <BaseBtn min @click="resetWindow">重置窗口</BaseBtn>
    </div>
    <div class="reset-row">
      <div>
        <strong>全部桌面歌词设置</strong>
        <p>恢复窗口行为、排版、字体和颜色，并关闭桌面歌词。</p>
      </div>
      <BaseBtn min outline @click="resetAll">恢复全部默认值</BaseBtn>
    </div>
  </dd>
</template>

<style scoped>
.master-card {
  border-color: color-mix(in srgb, var(--color-primary) 28%, var(--color-primary-alpha-900));
  background: color-mix(in srgb, var(--color-primary-background) 58%, transparent);
}
.master-row,
.reset-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
}
.master-row p,
.reset-row p {
  margin: 5px 0 0 25px;
  color: var(--color-font-label);
  font-size: 10px;
  line-height: 1.45;
}
.status {
  flex: none;
  padding: 5px 9px;
  border-radius: 999px;
  color: var(--color-font-label);
  background: var(--color-primary-background);
  font-size: 9px;
  font-weight: 650;
  letter-spacing: 0.04em;
}
.status.on {
  color: var(--color-primary);
}
.option-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px 24px;
}
.option-grid.compact {
  margin-top: 17px;
  grid-template-columns: repeat(3, minmax(0, 1fr));
}
.option-item {
  min-width: 0;
  padding: 7px 9px;
  border-radius: 8px;
  transition: background-color 0.16s ease;
}
.option-item:hover {
  background: var(--color-primary-background);
}
.option-item small {
  display: block;
  margin: 1px 0 0 25px;
  color: var(--color-font-label);
  font-size: 9px;
  line-height: 1.35;
}
.setting-group,
.font-row {
  display: flex;
  align-items: center;
  min-height: 38px;
  gap: 22px;
}
.setting-group + .setting-group {
  margin-top: 8px;
}
.group-label {
  flex: 0 0 92px;
  color: var(--color-font-label);
  font-size: 11px;
  font-weight: 550;
}
.font-row {
  margin-bottom: 18px;
}
.range-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px 28px;
}
.range-item {
  min-width: 0;
}
.range-item > span {
  display: flex;
  justify-content: space-between;
  margin-bottom: 9px;
  color: var(--color-font-label);
  font-size: 10px;
}
.range-item b {
  color: var(--color-font);
  font-size: 10px;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
}
.range-item input {
  width: 100%;
}
.weight-options {
  padding-top: 16px;
  border-top: 1px solid var(--color-primary-alpha-900);
}
.color-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
.color-item {
  display: grid;
  grid-template-columns: 36px 1fr;
  grid-template-rows: auto auto;
  align-items: center;
  column-gap: 10px;
  padding: 10px;
  border: 1px solid var(--color-primary-alpha-900);
  border-radius: 9px;
  cursor: pointer;
  background: color-mix(in srgb, var(--color-main-background) 92%, transparent);
}
.color-item input {
  grid-row: 1 / 3;
  width: 36px;
  height: 36px;
  padding: 0;
  border: 0;
  cursor: pointer;
}
.color-item span {
  font-size: 10px;
  font-weight: 600;
}
.color-item code {
  color: var(--color-font-label);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 8px;
  text-transform: uppercase;
}
.lyric-preview {
  position: relative;
  min-height: 116px;
  margin-top: 16px;
  padding: 26px 30px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 10px;
  overflow: hidden;
  border-radius: 10px;
  color: var(--preview-normal);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08);
}
.lyric-preview::after {
  content: 'LIVE STYLE';
  position: absolute;
  top: 10px;
  right: 12px;
  font:
    600 7px/1 ui-monospace,
    SFMono-Regular,
    Consolas,
    monospace;
  letter-spacing: 0.18em;
  opacity: 0.28;
}
.preview-active {
  color: var(--preview-active);
  font-weight: 720;
}
.preview-normal {
  font-size: 0.72em;
  opacity: 0.72;
}
.button-row {
  margin-top: 12px;
}
.reset-row + .reset-row {
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid var(--color-primary-alpha-900);
}
.reset-row strong {
  font-size: 11px;
  font-weight: 650;
}
.reset-row p {
  margin-left: 0;
}

@media (max-width: 900px) {
  .option-grid,
  .range-grid {
    grid-template-columns: 1fr;
  }
  .option-grid.compact,
  .color-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
