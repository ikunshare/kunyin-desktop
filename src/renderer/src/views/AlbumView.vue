<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import DetailHeader from '../components/DetailHeader.vue'
import SongRow from '../components/SongRow.vue'
import QualityDialog from '../components/QualityDialog.vue'
import { usePlayerStore, type QueueSource } from '../stores/player'
import {
  albumFolderName,
  getMusicItemKey,
  publishYear,
  type AlbumDisc,
  type MusicItem,
  type MusicSource
} from '@common'

const route = useRoute()
const player = usePlayerStore()

const album = ref<{
  name: string
  artist?: string
  cover?: string
  total?: number
  publishTime?: string
}>({ name: '' })
const tracks = ref<MusicItem[]>([])
/** 分碟（多碟专辑才有，如 QQ 的 index_cd/cdNameMap） */
const discs = ref<AlbumDisc[] | undefined>()
const loading = ref(false)

/**
 * 把曲目按碟切成段；无分碟信息时只有一段（name 为空，不渲染碟头）。
 * offset 是该段首曲在 tracks 里的下标，播放/下载仍用完整 tracks，顺序不受分段影响。
 */
const sections = computed(() => {
  if (!discs.value?.length) return [{ no: 0, name: '', offset: 0, tracks: tracks.value }]
  let offset = 0
  return discs.value.map((d) => {
    const seg = { ...d, offset, tracks: tracks.value.slice(offset, offset + d.count) }
    offset += d.count
    return seg
  })
})
/** 自定义碟名时前缀碟号（`CD1 · 漫卷霜色`），默认名则只显示 `CD1` */
function discLabel(sec: { no: number; name: string }): string {
  return sec.name === `CD${sec.no}` ? sec.name : `CD${sec.no} · ${sec.name}`
}

/** 整专下载目录名：`年份 艺人 - 专辑名`（专辑接口没给艺人时退回首曲艺人） */
const downloadDir = computed(() =>
  albumFolderName({
    name: album.value.name,
    artist: album.value.artist || tracks.value[0]?.artist,
    publishTime: album.value.publishTime
  })
)
const headerMeta = computed(() => {
  const year = publishYear(album.value.publishTime)
  const discCount = discs.value?.length ? `${discs.value.length} 碟` : ''
  return [`专辑 · ${album.value.total ?? tracks.value.length} 首`, discCount, year]
    .filter(Boolean)
    .join(' · ')
})

// ============ 整专下载 ============
const qualityDialog = ref(false)
function downloadAll(): void {
  if (!tracks.value.length) return
  qualityDialog.value = true
}
const toast = ref('')
let toastTimer: ReturnType<typeof setTimeout> | null = null
function showToast(msg: string): void {
  toast.value = msg
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = ''), 3600)
}
function onDownloadAdded(): void {
  showToast(`已加入下载 ${tracks.value.length} 首`)
}

/** albumKey 编码为 `source:id`（source 也可走 query.source） */
function parseKey(): { source: MusicSource; id: string } | null {
  const raw = String(route.params.albumKey ?? '')
  const qs = route.query.source as MusicSource | undefined
  if (qs) return { source: qs, id: raw }
  const idx = raw.indexOf(':')
  if (idx < 0) return null
  return { source: raw.slice(0, idx) as MusicSource, id: raw.slice(idx + 1) }
}

async function load(): Promise<void> {
  const key = parseKey()
  if (!key) return
  loading.value = true
  tracks.value = []
  discs.value = undefined
  try {
    const info = await window.api.discover.albumInfo(key.source, key.id)
    album.value = info
      ? {
          name: info.name,
          artist: info.artist,
          cover: info.cover,
          total: info.total,
          publishTime: info.publishTime
        }
      : { name: '专辑' }
    const res = await window.api.discover.albumSongs(key.source, key.id, 0, 100)
    tracks.value = res.result
    discs.value = res.discs
  } finally {
    loading.value = false
  }
}

watch(() => [route.params.albumKey, route.query.source], load, { immediate: true })

function isActive(item: MusicItem): boolean {
  return !!player.current && getMusicItemKey(player.current) === getMusicItemKey(item)
}
/** 专辑作为播放队列来源（id 与「我的列表」在线歌单同构：source:id） */
function playSource(): QueueSource | undefined {
  const key = parseKey()
  if (!key) return undefined
  return { kind: 'platform', id: `${key.source}:${key.id}`, name: album.value.name }
}
function play(item: MusicItem): void {
  player.playItem(item, tracks.value, { trackTrial: true, source: playSource() })
}
function playAll(): void {
  if (tracks.value.length) play(tracks.value[0])
}
</script>

<template>
  <div class="page">
    <DetailHeader
      :cover="album.cover"
      :title="album.name"
      :subtitle="album.artist"
      :meta="headerMeta"
      download
      @play-all="playAll"
      @download="downloadAll"
    />
    <div v-if="loading" class="hint">加载中…</div>
    <div v-else class="list">
      <template v-for="sec in sections" :key="sec.no">
        <div v-if="sec.name" class="disc-head">
          <span class="disc-name ellipsis">{{ discLabel(sec) }}</span>
          <span class="disc-count">{{ sec.tracks.length }} 首</span>
        </div>
        <SongRow
          v-for="(t, i) in sec.tracks"
          :key="getMusicItemKey(t)"
          :item="t"
          :index="sec.offset + i"
          :active="isActive(t)"
          @play="play(t)"
        />
      </template>
    </div>

    <QualityDialog
      v-if="qualityDialog"
      :items="tracks"
      :sub-dir="downloadDir"
      :discs="discs"
      numbered
      @added="onDownloadAdded"
      @close="qualityDialog = false"
    />

    <transition name="fade">
      <div v-if="toast" class="toast">{{ toast }}</div>
    </transition>
  </div>
</template>

<style scoped>
.list {
  display: flex;
  flex-direction: column;
}
.disc-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 12px 8px;
  font-size: 13px;
  color: var(--color-font-label);
}
.disc-head::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--color-primary-background-hover);
}
.disc-name {
  font-weight: 600;
  color: var(--color-font);
  max-width: 60%;
}
.disc-count {
  flex-shrink: 0;
}
.hint {
  padding: 20px 0;
  text-align: center;
  font-size: 13px;
  color: var(--color-font-label);
}
.toast {
  position: fixed;
  left: 50%;
  bottom: 88px;
  transform: translateX(-50%);
  z-index: 2000;
  padding: 9px 18px;
  border-radius: 999px;
  font-size: 13px;
  color: #fff;
  background: rgba(0, 0, 0, 0.72);
  pointer-events: none;
}
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.25s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
