<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import AppIcon from './AppIcon.vue'
import { coverUrl } from '../utils/cover'

const props = withDefaults(
  defineProps<{
    cover?: string
    title: string
    subtitle?: string
    meta?: string
    round?: boolean
    /** 是否显示「下载全部」按钮（专辑页用） */
    download?: boolean
    /** 是否显示返回按钮（详情页从列表/歌手页点进来，需要退回上一个状态） */
    back?: boolean
  }>(),
  { back: true }
)
const emit = defineEmits<{ playAll: []; download: [] }>()

const router = useRouter()

// 封面走主进程磁盘缓存协议
const cachedCover = computed(() => coverUrl(props.cover))
</script>

<template>
  <div class="detail-header">
    <button v-if="back" class="dh-back" title="返回" @click="router.back()">
      <AppIcon name="arrow-left" :size="18" />
    </button>
    <div class="dh-cover" :class="{ round }">
      <img v-if="cachedCover" :src="cachedCover" alt="" />
      <AppIcon v-else name="library" :size="40" />
    </div>
    <div class="dh-info">
      <div class="dh-title ellipsis-2">{{ title }}</div>
      <div v-if="subtitle" class="dh-subtitle ellipsis">{{ subtitle }}</div>
      <div v-if="meta" class="dh-meta">{{ meta }}</div>
      <div class="dh-actions">
        <button class="play-all" @click="emit('playAll')">
          <AppIcon name="play" :size="16" />
          <span>播放全部</span>
        </button>
        <button v-if="download" class="download-all" @click="emit('download')">
          <AppIcon name="download" :size="16" />
          <span>下载全部</span>
        </button>
        <button class="fav" title="收藏"><AppIcon name="heart" :size="18" /></button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.detail-header {
  display: flex;
  gap: 20px;
  padding: 10px 0 24px;
}
.dh-back {
  flex: none;
  align-self: flex-start;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  margin-right: -8px;
  border-radius: 50%;
  color: var(--color-font-label);
  transition:
    color 0.2s ease,
    background-color 0.2s ease;
}
.dh-back:hover {
  color: var(--color-font);
  background: var(--color-button-background-hover);
}
.dh-cover {
  flex: none;
  width: 160px;
  height: 160px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  overflow: hidden;
  color: var(--color-font-label);
  background: var(--color-primary-background);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16);
}
.dh-cover.round {
  border-radius: 50%;
}
.dh-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.dh-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
}
.dh-title {
  font-size: 22px;
  font-weight: 700;
  color: var(--color-font);
}
.dh-subtitle {
  margin-top: 8px;
  font-size: 13px;
  color: var(--color-font);
}
.dh-meta {
  margin-top: 4px;
  font-size: 12px;
  color: var(--color-font-label);
}
.dh-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 18px;
}
.play-all {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 9px 20px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 500;
  color: #fff;
  background: var(--color-primary);
  box-shadow: 0 4px 12px var(--color-primary-alpha-300);
  transition:
    background 0.2s ease,
    transform 0.1s ease;
}
.play-all:hover {
  background: var(--color-primary-dark-100);
}
.play-all:active {
  transform: scale(0.97);
}
.download-all {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 9px 20px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 500;
  color: var(--color-primary);
  background: var(--color-primary-background);
  border: 1px solid var(--color-primary-alpha-900);
  transition:
    background 0.2s ease,
    transform 0.1s ease;
}
.download-all:hover {
  background: var(--color-primary-background-hover);
}
.download-all:active {
  transform: scale(0.97);
}
.fav {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  color: var(--color-font-label);
  background: var(--color-primary-background);
  transition:
    color 0.2s ease,
    background 0.2s ease;
}
.fav:hover {
  color: var(--color-primary);
  background: var(--color-primary-background-hover);
}
</style>
