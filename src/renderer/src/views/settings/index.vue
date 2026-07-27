<script setup lang="ts">
import { nextTick, ref } from 'vue'
import AppIcon from '../../components/AppIcon.vue'
import SettingBasic from './SettingBasic.vue'
import SettingPlay from './SettingPlay.vue'
import SettingLyric from './SettingLyric.vue'
import SettingDesktopLyric from './SettingDesktopLyric.vue'
import SettingDownload from './SettingDownload.vue'
import SettingNetwork from './SettingNetwork.vue'
import SettingSync from './SettingSync.vue'
import SettingBackup from './SettingBackup.vue'
import SettingOther from './SettingOther.vue'
import SettingAbout from './SettingAbout.vue'

// 设置页整体布局移植自 lx-music-desktop（Apache-2.0, © lyswhut）views/Setting/index.vue：
// 左侧分类目录 + 右侧 dl>dt/dd 分组内容，切换分组后回滚到顶部。
defineOptions({ name: 'SettingsView' })

const tocList = [
  { id: 'SettingBasic', title: '基础设置' },
  { id: 'SettingPlay', title: '播放设置' },
  { id: 'SettingLyric', title: '歌词设置' },
  { id: 'SettingDesktopLyric', title: '桌面歌词' },
  { id: 'SettingDownload', title: '下载设置' },
  { id: 'SettingNetwork', title: '网络设置' },
  { id: 'SettingSync', title: '同步设置' },
  { id: 'SettingBackup', title: '备份与恢复' },
  { id: 'SettingOther', title: '其他设置' },
  { id: 'SettingAbout', title: '关于软件' }
] as const

type TocId = (typeof tocList)[number]['id']

const components: Record<TocId, unknown> = {
  SettingBasic,
  SettingPlay,
  SettingLyric,
  SettingDesktopLyric,
  SettingDownload,
  SettingNetwork,
  SettingSync,
  SettingBackup,
  SettingOther,
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
    <div class="toc scroll">
      <ul role="toolbar">
        <li v-for="h2 in tocList" :key="h2.id">
          <h2
            class="toc-h2"
            :class="{ active: activeId === h2.id }"
            role="tab"
            :aria-selected="activeId === h2.id"
            :aria-label="h2.title"
            @click="toggleTab(h2.id)"
          >
            <AppIcon
              v-if="activeId === h2.id"
              name="chevron-right"
              :size="12"
              class="active-icon"
            />
            {{ h2.title }}
          </h2>
        </li>
      </ul>
    </div>
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
  border-top: var(--color-list-header-border-bottom);
}
.toc {
  flex: 0 0 16%;
  min-width: 110px;
  overflow-y: auto;
}
.toc-h2 {
  display: flex;
  align-items: center;
  gap: 2px;
  line-height: 1.5;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 13px;
  font-weight: normal;
  color: var(--color-font);
  padding: 8px 10px;
  cursor: pointer;
  transition:
    background-color var(--transition-fast),
    color var(--transition-fast);
}
.toc-h2:not(.active):hover {
  background-color: var(--color-button-background-hover);
}
.toc-h2.active {
  color: var(--color-primary);
}
.active-icon {
  margin-left: -4px;
}

.setting {
  padding: 0 15px 15px;
  font-size: 14px;
  box-sizing: border-box;
  overflow-y: auto;
  height: 100%;
  width: 100%;
}

/* dt/dd/h3 全局分组排版（穿透到各分组组件，LX :global 做法） */
.setting :deep(dt) {
  border-left: 5px solid var(--color-primary-alpha-700);
  padding: 3px 7px;
  margin: 15px 0;
  font-weight: 600;
}
.setting :deep(dt + dd h3:first-child) {
  margin-top: 0;
}
.setting :deep(dd > div) {
  padding: 0 15px;
}
.setting :deep(h3) {
  font-size: 12px;
  font-weight: 600;
  margin: 25px 0 15px;
  color: var(--color-font);
}
.setting :deep(.p) {
  padding: 3px 0;
  line-height: 1.3;
}
.setting :deep(.gap-top) {
  margin-top: 10px;
}
.setting :deep(.gap-left) {
  margin-left: 15px;
}
.setting :deep(.gap-left:first-child) {
  margin-left: 0;
}
</style>
