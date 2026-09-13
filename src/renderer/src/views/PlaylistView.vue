<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import DetailHeader from '../components/DetailHeader.vue'
import SongRow from '../components/SongRow.vue'
import BaseBtn from '../components/BaseBtn.vue'
import { usePlayerStore, type QueueSource } from '../stores/player'
import { useLibraryStore } from '../stores/library'
import { getMusicItemKey, type MusicItem, type MusicSource } from '@common'
const route = useRoute()
const player = usePlayerStore()
const library = useLibraryStore()
const info = ref<{ name: string; cover?: string; creator?: string; total?: number }>({ name: '' })
const tracks = ref<MusicItem[]>([])
const loading = ref(false)
const busy = ref(false)
const error = ref('')
const message = ref('')
const page = ref(0)
const hasNext = ref(false)
let token = 0
const source = computed(() => route.query.source as MusicSource | undefined)
const chart = computed(() => route.query.chart === '1')
const identity = computed(
  () =>
    String(route.params.playlistId) +
    ':' +
    source.value +
    ':' +
    chart.value +
    ':' +
    route.query.period
)
async function load(more = false): Promise<void> {
  const request = more ? token : ++token
  const nextPage = more ? page.value + 1 : 0
  const src = source.value
  const id = String(route.params.playlistId)
  if (!more) {
    tracks.value = []
    hasNext.value = false
    message.value = ''
    busy.value = false
    info.value = {
      name: String(route.query.title || '歌单'),
      cover: String(route.query.cover || '')
    }
  }
  loading.value = true
  error.value = ''
  try {
    if (src) {
      if (!more && !chart.value) {
        const detail = await window.api.discover.playlistInfo(src, id)
        if (request !== token) return
        if (detail) info.value = detail
      }
      const result = chart.value
        ? await window.api.discover.chartSongs(
            src,
            id,
            nextPage,
            100,
            String(route.query.period || '')
          )
        : await window.api.discover.playlistSongs(src, id, nextPage, 100)
      if (request !== token) return
      const previousCount = tracks.value.length
      tracks.value = [
        ...new Map(
          [...tracks.value, ...result.result].map((item) => [getMusicItemKey(item), item])
        ).values()
      ]
      hasNext.value = result.hasNext && tracks.value.length > previousCount
      if (result.hasNext && tracks.value.length === previousCount)
        throw new Error('分页未返回新歌曲，请重试')
      if (more && !result.result.length) throw new Error('下一页暂时无法加载，请重试')
    } else {
      const songs = await library.playlistSongs(Number(id))
      if (request !== token) return
      const list = library.playlists.find((item) => item.id === Number(id))
      info.value = { name: list?.name || '歌单', cover: list?.coverUrl, total: songs.length }
      tracks.value = songs
    }
    page.value = nextPage
  } catch (e) {
    if (request === token) error.value = e instanceof Error ? e.message : '歌单加载失败'
  } finally {
    if (request === token) loading.value = false
  }
}
watch(identity, () => void load(), { immediate: true })
function playSource(): QueueSource {
  const id = String(route.params.playlistId)
  return source.value
    ? { kind: 'platform', id: source.value + ':' + id, name: info.value.name }
    : { kind: 'local', id, name: info.value.name }
}
function play(item: MusicItem): void {
  player.playItem(item, tracks.value, { source: playSource() })
}
async function playAll(): Promise<void> {
  if (busy.value || loading.value) return
  busy.value = true
  const key = identity.value
  try {
    while (hasNext.value && page.value < 99) {
      await load(true)
      if (identity.value !== key || error.value) return
    }
    if (hasNext.value) {
      error.value = '歌单过大，请先选择歌曲播放'
      return
    }
    if (identity.value === key && tracks.value.length) play(tracks.value[0])
  } finally {
    if (identity.value === key) busy.value = false
  }
}
async function collect(): Promise<void> {
  if (!source.value || busy.value) return
  busy.value = true
  const key = identity.value
  try {
    await window.api.library.importRemote(
      source.value,
      String(route.params.playlistId),
      info.value.name,
      chart.value,
      String(route.query.period || '')
    )
    await library.refresh()
    if (key === identity.value) message.value = '已收藏到我的歌单'
  } catch (e) {
    if (key === identity.value) error.value = e instanceof Error ? e.message : '收藏失败'
  } finally {
    if (key === identity.value) busy.value = false
  }
}
</script>
<template>
  <div class="page">
    <DetailHeader
      :cover="info.cover"
      :title="info.name"
      :subtitle="info.creator"
      :meta="(info.total ?? tracks.length) + ' 首歌曲'"
      @play-all="playAll"
    />
    <div class="actions">
      <BaseBtn v-if="source" :disabled="busy || loading" @click="collect">
        {{ busy ? '正在处理…' : '收藏到我的歌单' }}</BaseBtn
      ><span v-if="message" role="status">{{ message }}</span
      ><span v-if="hasNext">已加载 {{ tracks.length }} 首，播放全部会加载完整歌单</span>
    </div>
    <div v-if="error" class="hint" role="alert">
      {{ error }}
      <BaseBtn :disabled="loading || busy" @click="load(tracks.length > 0)">重试</BaseBtn>
    </div>
    <div class="list">
      <SongRow
        v-for="(item, i) in tracks"
        :key="getMusicItemKey(item)"
        :item="item"
        :index="i"
        :active="!!player.current && getMusicItemKey(player.current) === getMusicItemKey(item)"
        @play="play(item)"
      />
    </div>
    <div v-if="loading" class="hint">加载中…</div>
    <div v-else-if="hasNext" class="hint">
      <BaseBtn :disabled="busy" @click="load(true)">加载更多</BaseBtn>
    </div>
    <div v-else-if="!tracks.length && !error" class="hint">暂无可播放的歌曲</div>
  </div>
</template>
<style scoped>
.actions {
  padding: 0 24px 16px;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 14px;
  font-size: 12px;
  color: var(--color-font-label);
}
.list {
  display: flex;
  flex-direction: column;
}
.hint {
  padding: 20px;
  text-align: center;
  font-size: 13px;
  color: var(--color-font-label);
}
</style>
