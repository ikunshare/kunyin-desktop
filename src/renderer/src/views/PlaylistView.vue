<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import DetailHeader from '../components/DetailHeader.vue'
import SongRow from '../components/SongRow.vue'
import { usePlayerStore } from '../stores/player'
import { useLibraryStore } from '../stores/library'
import { getMusicItemKey, type MusicItem, type MusicSource } from '@common'

const route = useRoute()
const player = usePlayerStore()
const library = useLibraryStore()

const info = ref<{ name: string; cover?: string; creator?: string; total?: number }>({ name: '' })
const tracks = ref<MusicItem[]>([])
const loading = ref(false)

async function load(): Promise<void> {
  loading.value = true
  tracks.value = []
  const source = route.query.source as MusicSource | undefined
  const id = String(route.params.playlistId)
  try {
    if (source) {
      // 在线歌单（来自搜索/详情跳转）
      const detail = await window.api.discover.playlistInfo(source, id)
      info.value = detail
        ? { name: detail.name, cover: detail.cover, creator: detail.creator, total: detail.total }
        : { name: '歌单' }
      const res = await window.api.discover.playlistSongs(source, id, 0, 100)
      tracks.value = res.result
    } else {
      // 本地歌单
      const pid = Number(id)
      const pl = library.playlists.find((p) => p.id === pid)
      info.value = { name: pl?.name ?? '歌单', cover: pl?.coverUrl, total: pl?.songCount }
      tracks.value = await library.playlistSongs(pid)
    }
  } finally {
    loading.value = false
  }
}

watch(() => [route.params.playlistId, route.query.source], load, { immediate: true })

function isActive(item: MusicItem): boolean {
  return !!player.current && getMusicItemKey(player.current) === getMusicItemKey(item)
}
// 在线歌单播放累积进试听列表；本地歌单不动试听列表
const isOnline = computed(() => !!route.query.source)
function play(item: MusicItem): void {
  player.playItem(item, tracks.value, { trackTrial: isOnline.value })
}
function playAll(): void {
  if (tracks.value.length) play(tracks.value[0])
}
</script>

<template>
  <div class="page">
    <DetailHeader
      :cover="info.cover"
      :title="info.name"
      :subtitle="info.creator"
      :meta="`${info.total ?? tracks.length} 首歌曲`"
      @play-all="playAll"
    />
    <div v-if="loading" class="hint">加载中…</div>
    <div v-else class="list">
      <SongRow
        v-for="(t, i) in tracks"
        :key="getMusicItemKey(t)"
        :item="t"
        :index="i"
        :active="isActive(t)"
        @play="play(t)"
      />
    </div>
  </div>
</template>

<style scoped>
.list {
  display: flex;
  flex-direction: column;
}
.hint {
  padding: 20px 0;
  text-align: center;
  font-size: 13px;
  color: var(--color-font-label);
}
</style>
