<script setup lang="ts">
import { computed } from 'vue'

/** 内联 SVG 图标。stroke 风格为主，播放控件用 fill。inner 为可信常量。 */
interface IconDef {
  inner: string
  fill?: boolean
  viewBox?: string
}

const ICONS: Record<string, IconDef> = {
  search: { inner: '<circle cx="11" cy="11" r="7"/><path d="M16.5 16.5 21 21"/>' },
  library: {
    inner:
      '<path d="M9 17V4l11-2v13"/><circle cx="6.5" cy="17" r="2.5"/><circle cx="17.5" cy="15" r="2.5"/>'
  },
  download: { inner: '<path d="M12 4v11M8 11l4 4 4-4M5 20h14"/>' },
  upload: { inner: '<path d="M12 20V9M8 13l4-4 4 4M5 4h14"/>' },
  headphone: {
    inner:
      '<path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="2.5" y="13.5" width="4.5" height="6.5" rx="1.6"/><rect x="17" y="13.5" width="4.5" height="6.5" rx="1.6"/>'
  },
  // LX #icon-addTo：圆头粗加号（fill，42×42）
  'add-to': {
    inner:
      '<path d="M37.059,16H26V4.941C26,2.224,23.718,0,21,0s-5,2.224-5,4.941V16H4.941C2.224,16,0,18.282,0,21s2.224,5,4.941,5H16v11.059C16,39.776,18.282,42,21,42s5-2.224,5-4.941V26h11.059C39.776,26,42,23.718,42,21S39.776,16,37.059,16z"/>',
    fill: true,
    viewBox: '0 0 42 42'
  },
  settings: {
    inner:
      '<path d="M5 21v-6M5 11V3M12 21v-8M12 9V3M19 21v-4M19 13V3"/><circle cx="5" cy="13" r="2"/><circle cx="12" cy="7" r="2"/><circle cx="19" cy="15" r="2"/>'
  },
  play: { inner: '<path d="M8 5v14l11-7z"/>', fill: true },
  pause: { inner: '<path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/>', fill: true },
  'skip-back': { inner: '<path d="M7 5h2.2v14H7zM19 5 9 12l10 7z"/>', fill: true },
  'skip-forward': { inner: '<path d="M14.8 5H17v14h-2.2zM5 5l10 7L5 19z"/>', fill: true },
  heart: {
    inner: '<path d="M12 20.5 4.6 13a4.6 4.6 0 0 1 6.5-6.5l.9.9.9-.9a4.6 4.6 0 0 1 6.5 6.5z"/>'
  },
  'heart-filled': {
    inner: '<path d="M12 20.5 4.6 13a4.6 4.6 0 0 1 6.5-6.5l.9.9.9-.9a4.6 4.6 0 0 1 6.5 6.5z"/>',
    fill: true
  },
  volume: { inner: '<path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/>' },
  'volume-mute': { inner: '<path d="M11 5 6 9H3v6h3l5 4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>' },
  repeat: {
    inner:
      '<path d="M17 2l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>'
  },
  'repeat-one': {
    inner:
      '<path d="M17 2l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/><path d="M11 15v-4l-1.5 1"/>'
  },
  shuffle: {
    inner:
      '<path d="M16 3h5v5"/><path d="M4 20 21 3"/><path d="M21 16v5h-5"/><path d="M15 15l6 6"/><path d="M4 4l5 5"/>'
  },
  more: {
    inner:
      '<circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/>',
    fill: true
  },
  close: { inner: '<path d="M6 6l12 12M18 6 6 18"/>' },
  minus: { inner: '<path d="M5 12h14"/>' },
  maximize: { inner: '<rect x="5" y="5" width="14" height="14" rx="1"/>' },
  restore: {
    inner: '<path d="M8 8V5h11v11h-3"/><rect x="5" y="8" width="11" height="11" rx="1"/>'
  },
  eraser: {
    inner:
      '<path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/>'
  },
  'chevron-down': { inner: '<path d="m6 9 6 6 6-6"/>' },
  'chevron-right': { inner: '<path d="m9 6 6 6-6 6"/>' },
  // 返回：左箭头（详情页头部）
  'arrow-left': { inner: '<path d="M19 12H5"/><path d="m11 18-6-6 6-6"/>' },
  clock: { inner: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 1.8"/>' },
  locate: {
    inner: '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>'
  },
  folder: {
    inner:
      '<path d="M3 8a2 2 0 0 1 2-2h3.6l2 2H19a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'
  },
  plus: { inner: '<path d="M12 5v14M5 12h14"/>' },
  trash: {
    inner:
      '<path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/>'
  },
  edit: { inner: '<path d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3z"/>' },
  video: {
    inner: '<rect x="3" y="6" width="12" height="12" rx="2"/><path d="M15 10l6-3v10l-6-3z"/>'
  },
  // 歌词面板开关：几行唱词
  lyric: { inner: '<path d="M4 6h16M4 12h16M4 18h9"/>' },
  // 评论：气泡（feather message-circle）
  comment: {
    inner:
      '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>'
  },
  // 翻译：文 + A
  translate: {
    inner:
      '<path d="M4 5h9M8.5 3v2c0 4.2-2.1 7.4-5.5 9.2M4.8 8.5c1.4 2.6 3.9 4.9 7 6"/><path d="M12.5 21l4.2-9.5L21 21M13.9 17.5h5.6"/>'
  },
  check: { inner: '<path d="M4.5 12.5l5 5L19.5 7"/>' },
  // 排序：上下双箭头
  sort: { inner: '<path d="M7 4v13M4 14l3 3 3-3"/><path d="M17 20V7M14 10l3-3 3 3"/>' },
  // 复制/重复：双矩形
  copy: {
    inner: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>'
  },
  // 刷新/更新：环形箭头
  refresh: {
    inner: '<path d="M20 5v5h-5"/><path d="M19.4 13.5A7.5 7.5 0 1 1 18 7.2l2 2.8"/>'
  },
  info: { inner: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><path d="M12 7h.01"/>' }
}

const props = withDefaults(defineProps<{ name: string; size?: number }>(), { size: 20 })

const def = computed<IconDef>(() => ICONS[props.name] ?? ICONS.search)
</script>

<template>
  <!-- inner 为组件内可信常量（图标路径），非用户输入，无 XSS 风险 -->
  <!-- eslint-disable vue/no-v-html -->
  <svg
    class="app-icon"
    :width="size"
    :height="size"
    :viewBox="def.viewBox ?? '0 0 24 24'"
    :fill="def.fill ? 'currentColor' : 'none'"
    :stroke="def.fill ? 'none' : 'currentColor'"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    v-html="def.inner"
  />
  <!-- eslint-enable vue/no-v-html -->
</template>

<style scoped>
.app-icon {
  display: block;
  flex: none;
}
</style>
