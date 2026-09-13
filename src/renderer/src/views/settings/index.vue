<script setup lang="ts">
import { nextTick, ref } from 'vue'
import AppIcon from '../../components/AppIcon.vue'
import SettingBasic from './SettingBasic.vue'
import SettingPlay from './SettingPlay.vue'
import SettingShortcuts from './SettingShortcuts.vue'
import SettingLyric from './SettingLyric.vue'
import SettingDesktopLyric from './SettingDesktopLyric.vue'
import SettingDownload from './SettingDownload.vue'
import SettingNetwork from './SettingNetwork.vue'
import SettingSync from './SettingSync.vue'
import SettingBackup from './SettingBackup.vue'
import SettingOther from './SettingOther.vue'
import SettingDeveloper from './SettingDeveloper.vue'
import SettingAbout from './SettingAbout.vue'

// 设置页整体布局移植自 lx-music-desktop（Apache-2.0, © lyswhut）views/Setting/index.vue：
// 左侧分类目录 + 右侧 dl>dt/dd 分组内容，切换分组后回滚到顶部。
defineOptions({ name: 'SettingsView' })

const tocList = [
  { id: 'SettingBasic', title: '外观与界面', icon: 'settings' },
  { id: 'SettingPlay', title: '播放', icon: 'play' },
  { id: 'SettingShortcuts', title: '快捷键', icon: 'settings' },
  { id: 'SettingLyric', title: '歌词', icon: 'lyric' },
  { id: 'SettingDesktopLyric', title: '桌面歌词', icon: 'translate' },
  { id: 'SettingDownload', title: '下载', icon: 'download' },
  { id: 'SettingNetwork', title: '网络', icon: 'shuffle' },
  { id: 'SettingSync', title: '同步', icon: 'refresh' },
  { id: 'SettingBackup', title: '备份与恢复', icon: 'upload' },
  { id: 'SettingOther', title: '账户与其他', icon: 'more' },
  { id: 'SettingDeveloper', title: '开发者', icon: 'edit' },
  { id: 'SettingAbout', title: '关于', icon: 'info' }
] as const

type TocId = (typeof tocList)[number]['id']

const components: Record<TocId, unknown> = {
  SettingBasic,
  SettingPlay,
  SettingShortcuts,
  SettingLyric,
  SettingDesktopLyric,
  SettingDownload,
  SettingNetwork,
  SettingSync,
  SettingBackup,
  SettingOther,
  SettingDeveloper,
  SettingAbout
}

const activeId = ref<TocId>('SettingBasic')
const contentRef = ref<HTMLElement>()

function toggleTab(id: TocId): void {
  activeId.value = id
  void nextTick(() => {
    contentRef.value?.scrollTo({ top: 0, behavior: 'smooth' })
  })
}
</script>

<template>
  <div class="main">
    <aside class="toc scroll">
      <header class="toc-head">
        <span class="eyebrow">PREFERENCES</span>
        <h1>设置</h1>
        <p>让音乐按你的方式播放</p>
      </header>
      <ul role="toolbar">
        <li v-for="h2 in tocList" :key="h2.id">
          <button
            class="toc-h2"
            :class="{ active: activeId === h2.id }"
            role="tab"
            :aria-selected="activeId === h2.id"
            :aria-label="h2.title"
            @click="toggleTab(h2.id)"
          >
            <AppIcon :name="h2.icon" :size="17" />
            <span>{{ h2.title }}</span>
            <AppIcon name="chevron-right" :size="14" class="active-icon" />
          </button>
        </li>
      </ul>
    </aside>
    <div ref="contentRef" class="setting scroll">
      <dl>
        <component :is="components[activeId]" />
      </dl>
    </div>
  </div>
</template>

<style scoped>
.main {
  display: flex;
  flex-flow: row nowrap;
  height: 100%;
  background: color-mix(in srgb, var(--color-main-background) 92%, var(--color-primary) 8%);
}
.toc {
  flex: 0 0 218px;
  padding: 22px 14px 18px;
  overflow-y: auto;
  border-right: 1px solid var(--color-primary-alpha-900);
  background: color-mix(in srgb, var(--color-main-background) 78%, transparent);
}
.toc-head {
  padding: 0 10px 20px;
}
.eyebrow {
  display: block;
  margin-bottom: 5px;
  color: var(--color-primary);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.18em;
}
.toc-head h1 {
  font-size: 25px;
  line-height: 1.15;
  font-weight: 720;
  letter-spacing: -0.04em;
}
.toc-head p {
  margin-top: 7px;
  color: var(--color-font-label);
  font-size: 11px;
}
.toc ul {
  display: grid;
  gap: 3px;
}
.toc-h2 {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 11px;
  border: 0;
  border-radius: 9px;
  line-height: 1;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 12px;
  font-weight: 500;
  color: var(--color-font);
  background: transparent;
  padding: 10px 10px;
  cursor: pointer;
  transition:
    background-color 0.18s ease,
    color 0.18s ease,
    transform 0.18s ease;
}
.toc-h2:not(.active):hover {
  background-color: var(--color-button-background-hover);
  transform: translateX(2px);
}
.toc-h2.active {
  color: var(--color-primary);
  background: var(--color-primary-background);
  font-weight: 650;
}
.active-icon {
  margin-left: auto;
  opacity: 0;
  transform: translateX(-3px);
  transition: 0.18s ease;
}
.toc-h2.active .active-icon {
  opacity: 0.75;
  transform: none;
}

.setting {
  padding: 26px clamp(24px, 5vw, 64px) 48px;
  font-size: 14px;
  overflow-y: auto;
  height: 100%;
  width: 100%;
}
.setting dl {
  width: min(100%, 860px);
  margin: 0 auto;
}

.setting :deep(dt) {
  margin: 0 0 18px;
  font-size: 23px;
  line-height: 1.2;
  font-weight: 720;
  letter-spacing: -0.035em;
}
.setting :deep(dt + dd h3:first-child) {
  margin-top: 0;
}
.setting :deep(dd) {
  margin: 10px 0;
  padding: 18px 20px;
  border: 1px solid var(--color-primary-alpha-900);
  border-radius: 12px;
  background: color-mix(in srgb, var(--color-main-background) 90%, transparent);
  box-shadow: 0 5px 22px rgba(0, 0, 0, 0.025);
}
.setting :deep(dd > div) {
  padding: 0;
}
.setting :deep(h3) {
  font-size: 12px;
  font-weight: 650;
  margin: 0 0 13px;
  color: var(--color-font);
}
.setting :deep(h3 .hint) {
  margin-left: 7px;
  color: var(--color-font-label);
  font-size: 10px;
  font-weight: 400;
}
.setting :deep(dd + dd h3) {
  margin-top: 0;
}
.setting :deep(.p) {
  padding: 3px 0;
  line-height: 1.55;
}
.setting :deep(.gap-top) {
  margin-top: 12px;
}
.setting :deep(.gap-left) {
  margin-left: 14px;
}
.setting :deep(.gap-left:first-child) {
  margin-left: 0;
}
.setting :deep(input[type='text']),
.setting :deep(input[type='number']) {
  height: 36px;
  padding: 0 12px;
  border: 1px solid var(--color-primary-alpha-900);
  border-radius: 8px;
  outline: none;
  color: var(--color-font);
  background: color-mix(in srgb, var(--color-main-background) 88%, var(--color-primary) 12%);
  transition:
    border-color 0.2s ease,
    box-shadow 0.2s ease;
}
.setting :deep(input[type='text']:focus),
.setting :deep(input[type='number']:focus) {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 3px var(--color-primary-alpha-800);
}
.setting :deep(input[type='range']) {
  height: 4px;
  border-radius: 999px;
  accent-color: var(--color-primary);
}
.setting :deep(input[type='color']) {
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 0 0 1px var(--color-primary-alpha-800);
}

@media (max-width: 760px) {
  .toc {
    flex-basis: 170px;
  }
  .toc-head p {
    display: none;
  }
  .setting {
    padding-inline: 20px;
  }
}
</style>
