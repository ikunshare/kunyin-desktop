<script setup lang="ts">
import { ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useMvStore } from '../stores/mv'
import { useApi } from '../composables/useApi'
import type { MusicItem, MvQuality } from '@common'

const mv = useMvStore()
const { current } = storeToRefs(mv)
const api = useApi()

const qualities = ref<MvQuality[]>([])
const activeQuality = ref('')
const videoUrl = ref('')
const loading = ref(false)
const error = ref('')

// 过 IPC 前把 Pinia 响应式 Proxy 转成普通对象（contextBridge 无法克隆 Proxy）
function plain(item: MusicItem): MusicItem {
  return JSON.parse(JSON.stringify(item)) as MusicItem
}

async function loadUrl(item: MusicItem, quality: string): Promise<void> {
  loading.value = true
  error.value = ''
  videoUrl.value = ''
  const r = await api.discover.mvUrl(plain(item), quality).catch(() => null)
  loading.value = false
  if (r?.playUrl) {
    activeQuality.value = quality
    videoUrl.value = r.playUrl
  } else {
    error.value = r?.rejectReason || '无法获取播放地址'
  }
}

watch(
  current,
  async (item) => {
    qualities.value = []
    videoUrl.value = ''
    error.value = ''
    activeQuality.value = ''
    if (!item) return
    const snap = plain(item)
    loading.value = true
    const qs = await api.discover.mvQualities(snap).catch(() => [])
    qualities.value = qs
    loading.value = false
    if (qs.length) {
      await loadUrl(snap, qs[0].quality)
    } else {
      error.value = '该歌曲暂无可播放的 MV'
    }
  },
  { immediate: true }
)

function switchQuality(q: string): void {
  if (current.value && q !== activeQuality.value) void loadUrl(current.value, q)
}

const downloadMsg = ref('')
async function downloadMv(): Promise<void> {
  if (!current.value || !activeQuality.value) return
  await api.download.add({ item: plain(current.value), mvQuality: activeQuality.value })
  downloadMsg.value = '已加入下载队列'
  setTimeout(() => (downloadMsg.value = ''), 2000)
}
</script>

<template>
  <div v-if="current" class="mv-mask" @click.self="mv.close()">
    <div class="mv-box">
      <div class="mv-head">
        <span class="mv-title ellipsis">{{ current.title }} - {{ current.artist }}</span>
        <button class="mv-close" @click="mv.close()">✕</button>
      </div>
      <div class="mv-stage">
        <video v-if="videoUrl" :src="videoUrl" class="mv-video" controls autoplay />
        <div v-else class="mv-placeholder">
          {{ loading ? '加载中…' : error || '准备中…' }}
        </div>
      </div>
      <div v-if="qualities.length" class="mv-qualities">
        <button
          v-for="q in qualities"
          :key="q.quality"
          class="mv-q"
          :class="{ on: q.quality === activeQuality }"
          @click="switchQuality(q.quality)"
        >
          {{ q.displayName
          }}<span v-if="q.displaySize" class="mv-q-size"> · {{ q.displaySize }}</span>
        </button>
        <span class="mv-spacer" />
        <button class="mv-q mv-dl" :disabled="!videoUrl" @click="downloadMv">
          {{ downloadMsg || '下载' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mv-mask {
  position: fixed;
  inset: 0;
  z-index: 1100;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.7);
}
.mv-box {
  width: 78vw;
  max-width: 1100px;
  border-radius: 14px;
  background: #111;
  overflow: hidden;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
}
.mv-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  color: #fff;
}
.mv-title {
  font-size: 14px;
  font-weight: 500;
  min-width: 0;
}
.mv-close {
  flex: none;
  color: #bbb;
  font-size: 15px;
}
.mv-close:hover {
  color: #fff;
}
.mv-stage {
  position: relative;
  aspect-ratio: 16 / 9;
  background: #000;
}
.mv-video {
  width: 100%;
  height: 100%;
  display: block;
}
.mv-placeholder {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #999;
  font-size: 14px;
}
.mv-qualities {
  display: flex;
  gap: 8px;
  padding: 12px 16px;
  flex-wrap: wrap;
}
.mv-q {
  padding: 5px 12px;
  border-radius: 999px;
  font-size: 12px;
  color: #ccc;
  background: rgba(255, 255, 255, 0.08);
}
.mv-q.on {
  color: #fff;
  background: var(--color-primary);
}
.mv-q-size {
  opacity: 0.7;
}
.mv-spacer {
  flex: 1;
}
.mv-dl {
  color: #fff;
  background: var(--color-primary);
}
.mv-dl:disabled {
  opacity: 0.4;
}
</style>
