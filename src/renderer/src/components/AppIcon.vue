<script setup lang="ts">
import { computed } from 'vue'

/** 内联 SVG 图标。stroke 风格为主，播放控件用 fill。inner 为可信常量。 */
interface IconDef {
  inner: string
  fill?: boolean
}

const ICONS: Record<string, IconDef> = {
  search: { inner: '<circle cx="11" cy="11" r="7"/><path d="M16.5 16.5 21 21"/>' },
  library: {
    inner:
      '<path d="M9 17V4l11-2v13"/><circle cx="6.5" cy="17" r="2.5"/><circle cx="17.5" cy="15" r="2.5"/>'
  },
  download: { inner: '<path d="M12 4v11M8 11l4 4 4-4M5 20h14"/>' },
  upload: { inner: '<path d="M12 20V9M8 13l4-4 4 4M5 4h14"/>' },
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
  'chevron-down': { inner: '<path d="m6 9 6 6 6-6"/>' },
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
  }
}

const props = withDefaults(defineProps<{ name: string; size?: number }>(), { size: 20 })

const def = computed<IconDef>(() => ICONS[props.name] ?? ICONS.search)
</script>

<template>
  <!-- inner 为组件内可信常量（图标路径），非用户输入，无 XSS 风险 -->
  <!-- eslint-disable-next-line vue/no-v-html -->
  <svg
    class="app-icon"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    :fill="def.fill ? 'currentColor' : 'none'"
    :stroke="def.fill ? 'none' : 'currentColor'"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    v-html="def.inner"
  />
</template>

<style scoped>
.app-icon {
  display: block;
  flex: none;
}
</style>
