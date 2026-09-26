<script setup lang="ts">
/**
 * 评论楼层（递归渲染回复链）。
 *
 * 各音源的「楼中楼」深度不一，Provider 已统一归一化成 CommentItem.reply 树，
 * 这里只按树递归即可。
 */
import type { CommentItem } from '@common'
import { ref } from 'vue'
import AppIcon from './AppIcon.vue'
import { coverUrl } from '../utils/cover'

defineProps<{ comments: CommentItem[]; depth?: number }>()

/** 无头像时用昵称首字占位，免得一排破图 */
function initial(name: string): string {
  return name ? name.slice(0, 1).toUpperCase() : '?'
}

// 头像域名（尤其酷我）并非都支持 https，加载失败的一律退回首字占位
const brokenAvatars = ref(new Set<string>())
function onAvatarError(id: string): void {
  brokenAvatars.value = new Set(brokenAvatars.value).add(id)
}
</script>

<template>
  <ul class="floor">
    <li v-for="item in comments" :key="item.id" class="item">
      <div class="row">
        <img
          v-if="item.avatar && !brokenAvatars.has(item.id)"
          class="avatar"
          :src="coverUrl(item.avatar)"
          alt=""
          loading="lazy"
          decoding="async"
          @error="onAvatarError(item.id)"
        />
        <div v-else class="avatar avatar-empty">{{ initial(item.userName) }}</div>

        <div class="body">
          <div class="head">
            <span class="name ellipsis">{{ item.userName }}</span>
            <span v-if="item.timeStr" class="meta">{{ item.timeStr }}</span>
            <span v-if="item.location" class="meta">{{ item.location }}</span>
            <span v-if="item.likedCount != null" class="likes">
              <AppIcon name="heart" :size="12" />
              {{ item.likedCount }}
            </span>
          </div>
          <p v-if="item.text" class="text">{{ item.text }}</p>
          <div v-if="item.images?.length" class="images">
            <img
              v-for="(url, i) in item.images"
              :key="i"
              :src="coverUrl(url)"
              alt=""
              loading="lazy"
              decoding="async"
            />
          </div>
        </div>
      </div>

      <!-- 回复链：递归自身，缩进一级 -->
      <CommentFloor
        v-if="item.reply.length"
        class="reply"
        :comments="item.reply"
        :depth="(depth ?? 0) + 1"
      />
    </li>
  </ul>
</template>

<style scoped>
.floor {
  list-style: none;
  margin: 0;
  padding: 0;
}
.item + .item {
  border-top: 1px dashed var(--color-primary-alpha-900);
}
.row {
  display: flex;
  gap: 10px;
  padding: 12px 0;
}
.avatar {
  flex: none;
  width: 36px;
  height: 36px;
  border-radius: 8px;
  object-fit: cover;
  background: var(--color-button-background);
}
.avatar-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 15px;
  font-weight: 600;
  color: var(--color-font-label);
}
.body {
  flex: auto;
  min-width: 0;
}
.head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--color-font-label);
}
.name {
  flex: 0 1 auto;
  min-width: 0;
  font-size: 13px;
  color: var(--color-font);
}
.meta {
  flex: none;
}
.likes {
  flex: none;
  display: flex;
  align-items: center;
  gap: 3px;
  margin-left: auto;
}
.text {
  margin: 4px 0 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--color-font);
  white-space: pre-wrap;
  overflow-wrap: break-word;
  word-break: break-word;
}
.images {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 6px;
}
.images img {
  max-width: 160px;
  max-height: 160px;
  border-radius: 6px;
  object-fit: cover;
}
.ellipsis {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 回复层：左侧缩进 + 淡底，视觉上区分楼中楼 */
.reply {
  margin: 0 0 12px 46px;
  padding: 0 10px;
  border-radius: 8px;
  background: var(--color-primary-light-500-alpha-700);
}
.reply :deep(.item:first-child) {
  border-top: none;
}
</style>
