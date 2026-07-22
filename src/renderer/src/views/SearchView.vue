<script setup lang="ts">
import { onMounted, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useSearchStore } from '../stores/search'
import { usePlayerStore } from '../stores/player'
import { PLATFORMS, PLATFORM_NAMES, getMusicItemKey, type MusicSource } from '@common'
import SongRow from '../components/SongRow.vue'
import AppTabs from '../components/AppTabs.vue'

defineOptions({ name: 'SearchView' })

const searchStore = useSearchStore()
const player = usePlayerStore()
const { source, keyword, results, loading, hotWords } = storeToRefs(searchStore)

const sourceTabs = PLATFORMS.map((p) => ({ id: p, label: PLATFORM_NAMES[p] }))

function switchSource(id: string): void {
  source.value = id as MusicSource
  if (keyword.value) void searchStore.search()
  else void searchStore.loadHot()
}

function isActive(item: (typeof results.value)[number]): boolean {
  return !!player.current && getMusicItemKey(player.current) === getMusicItemKey(item)
}

onMounted(() => {
  if (!results.value.length && !keyword.value) void searchStore.loadHot()
})

// 音源热搜词随 tab 切换刷新（无检索时）
watch(source, () => {
  if (!keyword.value) void searchStore.loadHot()
})
</script>

<template>
  <div class="search-view">
    <div class="header">
      <AppTabs :model-value="source" :list="sourceTabs" @change="switchSource" />
    </div>
    <div class="body scroll">
      <div v-if="loading" class="hint">搜索中…</div>

      <div v-else-if="results.length" class="list">
        <SongRow
          v-for="(item, i) in results"
          :key="getMusicItemKey(item)"
          :item="item"
          :index="i"
          :active="isActive(item)"
          @play="player.playItem(item, results, { trackTrial: true })"
        />
      </div>

      <div v-else-if="keyword" class="empty">未找到「{{ keyword }}」相关歌曲</div>

      <div v-else class="hot">
        <div class="hot-title">热门搜索</div>
        <div class="hot-list">
          <button
            v-for="(w, i) in hotWords"
            :key="w + i"
            class="hot-chip"
            @click="searchStore.searchFor(w)"
          >
            <span class="rank" :class="{ top: i < 3 }">{{ i + 1 }}</span>
            <span class="word ellipsis">{{ w }}</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.search-view {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.header {
  flex: none;
  padding-top: 10px;
}
.body {
  flex: 1;
  min-height: 0;
  padding: 10px 15px 20px;
}
.list {
  display: flex;
  flex-direction: column;
}
.hint,
.empty {
  padding: 15px 0;
  color: var(--color-font-label);
  font-size: 13px;
}

/* 热门搜索（仿 LX：双列排行，前三名高亮主色） */
.hot {
  padding: 6px 4px;
}
.hot-title {
  margin: 6px 4px 14px;
  font-size: 15px;
  font-weight: 600;
  color: var(--color-font);
}
.hot-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 4px 24px;
}
.hot-chip {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 9px 8px;
  border-radius: var(--form-radius);
  text-align: left;
  color: var(--color-font);
  transition: background-color 0.15s ease;
}
.hot-chip:hover {
  background-color: var(--color-primary-background);
}
.rank {
  flex: none;
  width: 22px;
  text-align: center;
  font-size: 14px;
  font-variant-numeric: tabular-nums;
  color: var(--color-font-label);
}
.rank.top {
  color: var(--color-primary);
  font-weight: 700;
}
.word {
  flex: 1;
  min-width: 0;
  font-size: 13.5px;
}
</style>
