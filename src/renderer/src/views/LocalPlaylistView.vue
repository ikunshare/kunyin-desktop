<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { storeToRefs } from 'pinia'
import DetailHeader from '../components/DetailHeader.vue'
import SongRow from '../components/SongRow.vue'
import { usePlayerStore, type QueueSource } from '../stores/player'
import { useLibraryStore } from '../stores/library'
import { getMusicItemKey, type MusicItem } from '@common'

const route = useRoute()
const player = usePlayerStore()
const library = useLibraryStore()
const { playlists } = storeToRefs(library)

// type: favorites → 我的收藏；recent → 试听列表
const kind = computed<'favorites' | 'trial'>(() =>
  route.params.type === 'recent' ? 'trial' : 'favorites'
)
const title = computed(() => (kind.value === 'trial' ? '试听列表' : '我的收藏'))
const playlistId = computed(() => playlists.value.find((p) => p.systemKind === kind.value)?.id)

const tracks = ref<MusicItem[]>([])

async function reload(): Promise<void> {
  const id = playlistId.value
  tracks.value = id ? await library.playlistSongs(id) : []
}

// 歌单 id 就绪或库变更时重载
watch(playlistId, reload, { immediate: true })
watch(() => library.playlists, reload, { deep: true })

function isActive(item: MusicItem): boolean {
  return !!player.current && getMusicItemKey(player.current) === getMusicItemKey(item)
}
/** 收藏/试听列表作为播放队列来源（trial 单独标识，左栏也能匹配到试听列表） */
function playSource(): QueueSource | undefined {
  const id = playlistId.value
  if (id == null) return undefined
  return kind.value === 'trial'
    ? { kind: 'trial', id: String(id), name: '试听列表' }
    : { kind: 'local', id: String(id), name: '我的收藏' }
}
function play(item: MusicItem): void {
  player.playItem(item, tracks.value, { source: playSource() })
}
function playAll(): void {
  if (tracks.value.length) play(tracks.value[0])
}
</script>

<template>
  <div class="page">
    <DetailHeader :title="title" :meta="`${tracks.length} 首歌曲`" @play-all="playAll" />
    <div v-if="tracks.length" class="list">
      <SongRow
        v-for="(t, i) in tracks"
        :key="getMusicItemKey(t)"
        :item="t"
        :index="i"
        :active="isActive(t)"
        @play="play(t)"
      />
    </div>
    <div v-else class="empty">{{ kind === 'trial' ? '还没有播放记录' : '还没有收藏的歌曲' }}</div>
  </div>
</template>

<style scoped>
.list {
  display: flex;
  flex-direction: column;
}
.empty {
  padding: 30px 0;
  text-align: center;
  font-size: 13px;
  color: var(--color-font-label);
}
</style>
