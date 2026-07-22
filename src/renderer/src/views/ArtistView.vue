<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import DetailHeader from '../components/DetailHeader.vue'
import SongRow from '../components/SongRow.vue'
import { usePlayerStore } from '../stores/player'
import { getMusicItemKey, type MusicItem, type MusicSource } from '@common'

const route = useRoute()
const player = usePlayerStore()

const artist = ref<{ name: string; cover?: string; songCount?: number }>({ name: '' })
const tracks = ref<MusicItem[]>([])
const loading = ref(false)

/** artistKey 编码为 `source:id`（source 也可走 query.source） */
function parseKey(): { source: MusicSource; id: string } | null {
  const raw = String(route.params.artistKey ?? '')
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
  try {
    const info = await window.api.discover.artistInfo(key.source, key.id)
    artist.value = info
      ? { name: info.name, cover: info.cover, songCount: info.songCount }
      : { name: '歌手' }
    const res = await window.api.discover.artistSongs(key.source, key.id, 0, 100)
    tracks.value = res.result
  } finally {
    loading.value = false
  }
}

watch(() => [route.params.artistKey, route.query.source], load, { immediate: true })

function isActive(item: MusicItem): boolean {
  return !!player.current && getMusicItemKey(player.current) === getMusicItemKey(item)
}
function playAll(): void {
  if (tracks.value.length) player.playItem(tracks.value[0], tracks.value, { trackTrial: true })
}
</script>

<template>
  <div class="page">
    <DetailHeader
      round
      :cover="artist.cover"
      :title="artist.name"
      subtitle="歌手"
      :meta="`${artist.songCount ?? tracks.length} 首热门歌曲`"
      @play-all="playAll"
    />
    <div class="section-title">热门歌曲</div>
    <div v-if="loading" class="hint">加载中…</div>
    <div v-else class="list">
      <SongRow
        v-for="(t, i) in tracks"
        :key="getMusicItemKey(t)"
        :item="t"
        :index="i"
        :active="isActive(t)"
        @play="player.playItem(t, tracks, { trackTrial: true })"
      />
    </div>
  </div>
</template>

<style scoped>
.section-title {
  margin: 8px 0 10px;
  font-size: 14px;
  font-weight: 600;
  color: var(--color-font);
}
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
