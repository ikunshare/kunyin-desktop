<script setup lang="ts">
import { useRouter } from 'vue-router'
import { ref } from 'vue'
import { PLATFORM_SHORT_TAGS, type PlayListInfoResult } from '@common'
import AppIcon from './AppIcon.vue'
import { coverUrl } from '../utils/cover'

/**
 * 歌单卡片网格（对齐 LX songList/List/components/SongList：左封面、右文字的横向卡片）。
 * 供热门歌单页与搜索「歌单」结果共用。
 */
withDefaults(defineProps<{ items: PlayListInfoResult[]; showSource?: boolean }>(), {
  showSource: false
})
const router = useRouter()
const brokenCovers = ref(new Set<string>())

function open(item: PlayListInfoResult): void {
  void router.push({
    name: 'playlist',
    params: { playlistId: item.id },
    query: { source: item.source, title: item.name, cover: item.cover ?? '' }
  })
}
function count(value: number): string {
  if (value >= 100000000) return `${(value / 100000000).toFixed(1)}亿`
  return value >= 10000 ? `${(value / 10000).toFixed(1)}万` : String(value)
}
</script>

<template>
  <ul class="playlist-grid">
    <li
      v-for="item in items"
      :key="`${item.source}:${item.id}`"
      class="playlist-card"
      tabindex="0"
      :title="item.description || item.name"
      @click="open(item)"
      @keydown.enter="open(item)"
    >
      <div class="art">
        <img
          v-if="item.cover && !brokenCovers.has(item.cover)"
          :src="coverUrl(item.cover)"
          loading="lazy"
          decoding="async"
          alt=""
          @error="brokenCovers.add(item.cover!)"
        />
        <AppIcon v-else name="library" :size="30" />
      </div>
      <div class="desc">
        <h4 class="ellipsis-2">{{ item.name }}</h4>
        <div class="meta">
          <p v-if="item.creator" class="author ellipsis">{{ item.creator }}</p>
          <div class="info">
            <span v-if="item.total != null" title="歌曲数">
              <AppIcon name="library" :size="11" />{{ item.total }}
            </span>
            <span v-if="item.playCount" title="播放量">
              <AppIcon name="headphone" :size="11" />{{ count(item.playCount) }}
            </span>
            <span v-if="showSource" class="src">{{ PLATFORM_SHORT_TAGS[item.source] }}</span>
          </div>
        </div>
      </div>
    </li>
  </ul>
</template>

<style scoped>
.playlist-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 20px 24px;
}
.playlist-card {
  display: flex;
  min-width: 0;
  max-width: 420px;
  border-radius: 8px;
  color: var(--color-font);
  cursor: pointer;
  outline: none;
  transition: opacity 0.2s ease;
}
.playlist-card:hover {
  opacity: 0.75;
}
.playlist-card:focus-visible {
  box-shadow: 0 0 0 3px var(--color-primary-alpha-600);
}
.art {
  flex: none;
  width: 40%;
  aspect-ratio: 1;
  border-radius: 4px;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-primary-background);
  color: var(--color-primary-font);
  opacity: 0.9;
  box-shadow: 0 0 2px 0 rgba(0, 0, 0, 0.2);
}
.art img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.desc {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 2px 12px 2px 8px;
}
h4 {
  display: -webkit-box;
  font-size: 14px;
  line-height: 1.3;
  font-weight: 500;
}
.meta {
  min-width: 0;
}
.author {
  font-size: 12px;
  color: var(--color-font-label);
}
.info {
  display: flex;
  align-items: center;
  gap: 15px;
  margin-top: 8px;
  font-size: 12px;
  color: var(--color-font-label);
}
.info span {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}
.src {
  opacity: 0.8;
}
</style>
