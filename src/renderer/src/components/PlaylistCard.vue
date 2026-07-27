<script setup lang="ts">
import { useRouter } from 'vue-router'
import type { PlayListInfoResult } from '@common'
import { coverUrl } from '../utils/cover'

const props = defineProps<{ item: PlayListInfoResult }>()
const router = useRouter()

function open(): void {
  router.push({ name: 'playlist', params: { playlistId: props.item.id } })
}
</script>

<template>
  <div class="card" @click="open">
    <div class="cover">
      <img :src="coverUrl(item.cover)" alt="" />
      <span v-if="item.total" class="count">{{ item.total }} 首</span>
    </div>
    <div class="name ellipsis-2">{{ item.name }}</div>
    <div v-if="item.creator" class="creator ellipsis">{{ item.creator }}</div>
  </div>
</template>

<style scoped>
.card {
  cursor: pointer;
}
.cover {
  position: relative;
  aspect-ratio: 1 / 1;
  border-radius: var(--radius-border);
  overflow: hidden;
  background: var(--color-primary-background);
  box-shadow: 0 0 2px rgba(0, 0, 0, 0.12);
  transition: box-shadow 0.3s ease;
}
.card:hover .cover {
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
}
.cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.count {
  position: absolute;
  right: 6px;
  bottom: 6px;
  padding: 2px 6px;
  border-radius: var(--form-radius);
  font-size: 11px;
  color: #fff;
  background: rgba(0, 0, 0, 0.4);
}
.name {
  margin-top: 8px;
  font-size: 13px;
  line-height: 1.35;
  color: var(--color-font);
}
.creator {
  margin-top: 2px;
  font-size: 12px;
  color: var(--color-font-label);
}
</style>
