<script setup lang="ts">
import { RouterLink } from 'vue-router'
import AppIcon from './AppIcon.vue'

// 结构与交互移植自 lx-music-desktop（Apache-2.0, © lyswhut）
// components/layout/Aside/{index.vue, NavBar.vue}：文字 logo + 满宽近方形导航项。
const navItems = [
  { name: 'search', label: '搜索', icon: 'search' },
  { name: 'discover', label: '发现歌单', icon: 'compass' },
  { name: 'charts', label: '排行榜', icon: 'chart' },
  { name: 'playlists', label: '歌单', icon: 'library' },
  { name: 'download', label: '下载', icon: 'download' },
  { name: 'settings', label: '设置', icon: 'settings' }
] as const
</script>

<template>
  <aside class="aside">
    <nav class="menu">
      <ul class="list" role="toolbar">
        <li v-for="item in navItems" :key="item.name" class="nav-item" role="presentation">
          <RouterLink
            :to="{ name: item.name }"
            class="link no-drag"
            active-class="active"
            role="tab"
            :aria-label="item.label"
            :title="item.label"
          >
            <AppIcon :name="item.icon" :size="20" />
          </RouterLink>
        </li>
      </ul>
    </nav>
  </aside>
</template>

<style scoped>
/* 整栏可拖动窗口；nav 项 84% padding 撑起近方形，active 左侧竖条全高滑入（LX 原版效果） */
.aside {
  height: 100%;
  display: flex;
  flex-flow: column nowrap;
  -webkit-app-region: drag;
  -webkit-user-select: none;
  transition: background-color var(--transition-normal);
}
.logo {
  flex: none;
  box-sizing: border-box;
  padding: 0 13%;
  height: 50px;
  line-height: 50px;
  text-align: center;
  font-weight: bold;
  font-size: 15px;
  color: var(--color-nav-font);
  opacity: 0.8;
  overflow: hidden;
  white-space: nowrap;
}
.menu {
  flex: auto;
}
.list {
  -webkit-app-region: no-drag;
}
.nav-item {
  position: relative;
}
.nav-item::before {
  content: '';
  display: block;
  width: 100%;
  padding-bottom: 84%;
}
.link {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-nav-font);
  cursor: pointer;
  outline: none;
  transition:
    background-color var(--transition-fast),
    opacity var(--transition-fast);
}
.link::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  width: 3px;
  height: 100%;
  background-color: var(--color-primary-dark-200-alpha-700);
  border-radius: 4px;
  transform: translateX(-100%);
  transition: transform var(--transition-fast);
}
.link.active {
  background-color: var(--color-primary-light-300-alpha-700);
}
.link.active::before {
  transform: translateX(0);
}
.link.active:hover {
  background-color: var(--color-primary-light-300-alpha-800);
}
.link:hover {
  color: var(--color-nav-font);
}
.link:hover:not(.active) {
  opacity: 0.8;
  background-color: var(--color-primary-light-400-alpha-700);
}
.link:active:not(.active) {
  opacity: 0.6;
  background-color: var(--color-primary-light-300-alpha-600);
}
</style>
