<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import AppIcon from '../components/AppIcon.vue'
import { useDownloadStore } from '../stores/download'
import { coverUrl } from '../utils/cover'
import type { DownloadStatus } from '@common'

defineOptions({ name: 'DownloadView' })

const download = useDownloadStore()
const { tasks } = storeToRefs(download)

const hasCompleted = computed(() => tasks.value.some((t) => t.status === 'completed'))

function fmtSize(bytes: number): string {
  if (!bytes) return ''
  const mb = bytes / 1024 / 1024
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${(bytes / 1024).toFixed(0)} KB`
}
function fmtSpeed(bps: number): string {
  if (!bps) return ''
  const mb = bps / 1024 / 1024
  return mb >= 1 ? `${mb.toFixed(1)} MB/s` : `${(bps / 1024).toFixed(0)} KB/s`
}
function statusText(s: DownloadStatus): string {
  return {
    waiting: '等待中',
    downloading: '下载中',
    paused: '已暂停',
    completed: '已完成',
    failed: '失败'
  }[s]
}
</script>

<template>
  <div v-if="tasks.length" class="page">
    <div class="head">
      <span class="title">下载任务（{{ tasks.length }}）</span>
      <button v-if="hasCompleted" class="clear" @click="download.clearCompleted()">
        清除已完成
      </button>
    </div>
    <div class="list">
      <div v-for="t in tasks" :key="t.taskKey" class="task" :class="t.status">
        <div class="cover">
          <img v-if="t.cover" :src="coverUrl(t.cover)" alt="" />
          <AppIcon v-else name="download" :size="18" />
        </div>
        <div class="meta">
          <div class="title-row">
            <span class="song-title ellipsis">{{ t.title }}</span>
            <span class="quality">{{ t.qualityName }}</span>
          </div>
          <div class="artist ellipsis">{{ t.artist }}</div>
          <div class="progress-bar">
            <div class="progress-fill" :style="{ width: t.progress * 100 + '%' }" />
          </div>
          <div class="sub">
            <span class="status">{{ statusText(t.status) }}</span>
            <span v-if="t.status === 'downloading'" class="detail">
              {{ fmtSpeed(t.speedBytesPerSec) }} · {{ fmtSize(t.downloadedBytes) }} /
              {{ fmtSize(t.totalBytes) }}
            </span>
            <span v-else-if="t.status === 'failed'" class="err ellipsis">{{ t.errorMessage }}</span>
          </div>
        </div>
        <div class="ops">
          <button
            v-if="t.status === 'downloading' || t.status === 'waiting'"
            class="op"
            title="暂停"
            @click="download.pause(t.taskKey)"
          >
            <AppIcon name="pause" :size="16" />
          </button>
          <button
            v-else-if="t.status === 'paused'"
            class="op"
            title="继续"
            @click="download.resume(t.taskKey)"
          >
            <AppIcon name="play" :size="16" />
          </button>
          <button
            v-else-if="t.status === 'failed'"
            class="op"
            title="重试"
            @click="download.retry(t.taskKey)"
          >
            <AppIcon name="download" :size="16" />
          </button>
          <button class="op" title="移除" @click="download.remove(t.taskKey)">
            <AppIcon name="trash" :size="16" />
          </button>
        </div>
      </div>
    </div>
  </div>

  <div v-else class="empty">
    <span class="empty-icon"><AppIcon name="download" :size="40" /></span>
    <p class="empty-text">暂无下载任务</p>
    <p class="empty-hint">在歌曲上选择下载，即可离线收听</p>
  </div>
</template>

<style scoped>
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}
.title {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-font);
}
.clear {
  font-size: 12px;
  color: var(--color-font-label);
  transition: color 0.15s ease;
}
.clear:hover {
  color: var(--color-primary);
}
.list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.task {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px;
  border-radius: var(--radius-border);
  background: var(--color-primary-background);
}
.cover {
  flex: none;
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-border);
  overflow: hidden;
  color: var(--color-font-label);
  background: var(--color-primary-background-hover);
}
.cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.meta {
  flex: 1;
  min-width: 0;
}
.title-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.song-title {
  font-size: 13px;
  color: var(--color-font);
}
.quality {
  flex: none;
  font-size: 11px;
  color: var(--color-primary);
}
.artist {
  font-size: 12px;
  color: var(--color-font-label);
}
.progress-bar {
  height: 3px;
  margin: 6px 0 4px;
  border-radius: 999px;
  background: var(--color-primary-background-hover);
}
.progress-fill {
  height: 100%;
  border-radius: 999px;
  background: var(--color-primary);
  transition: width 0.3s linear;
}
.task.completed .progress-fill {
  background: var(--color-primary);
}
.task.failed .progress-fill {
  background: #e05a5a;
}
.sub {
  display: flex;
  gap: 10px;
  font-size: 11px;
  color: var(--color-font-label);
}
.err {
  color: #e05a5a;
}
.ops {
  flex: none;
  display: flex;
  gap: 6px;
}
.op {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  color: var(--color-font-label);
  transition:
    color 0.15s ease,
    background 0.15s ease;
}
.op:hover {
  color: var(--color-primary);
  background: var(--color-primary-background-hover);
}

.empty {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
}
.empty-icon {
  display: flex;
  color: var(--color-font-label);
  opacity: 0.5;
  margin-bottom: 4px;
}
.empty-text {
  font-size: 15px;
  color: var(--color-font);
}
.empty-hint {
  font-size: 13px;
  color: var(--color-font-label);
}
</style>
