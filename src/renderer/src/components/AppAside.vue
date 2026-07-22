<script setup lang="ts">
import { RouterLink } from 'vue-router'
import AppIcon from './AppIcon.vue'

const navItems = [
  { name: 'search', label: '搜索', icon: 'search' },
  { name: 'playlists', label: '歌单', icon: 'library' },
  { name: 'download', label: '下载', icon: 'download' },
  { name: 'settings', label: '设置', icon: 'settings' }
] as const
</script>

<template>
  <aside class="aside">
    <div class="brand" title="坤音"></div>
    <nav class="nav">
      <RouterLink
        v-for="item in navItems"
        :key="item.name"
        :to="{ name: item.name }"
        class="nav-item"
        active-class="active"
        :title="item.label"
      >
        <AppIcon :name="item.icon" :size="22" />
      </RouterLink>
    </nav>
  </aside>
</template>

<style scoped>
.aside {
  width: var(--width-aside);
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 14px 0;
}
.brand {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  margin-bottom: 20px;
  border-radius: var(--radius-border);
  background-color: var(--color-primary);
  color: #fff;
  font-size: 17px;
  font-weight: 700;
}
.nav {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}
.nav-item {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: var(--radius-border);
  color: var(--color-nav-font);
  opacity: 0.55;
  transition:
    background-color 0.3s ease,
    opacity 0.3s ease;
}
.nav-item:hover {
  opacity: 0.8;
  background-color: var(--color-primary-background-hover);
}
.nav-item.active {
  opacity: 1;
  color: var(--color-primary);
  background-color: var(--color-primary-background-active);
}
.nav-item.active::before {
  content: '';
  position: absolute;
  left: -8px;
  top: 50%;
  transform: translateY(-50%);
  width: 3px;
  height: 18px;
  border-radius: var(--radius-progress);
  background-color: var(--color-primary-dark-200-alpha-700);
}
</style>
