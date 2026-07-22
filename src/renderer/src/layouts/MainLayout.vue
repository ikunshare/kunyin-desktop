<script setup lang="ts">
import { RouterView } from 'vue-router'
import AppAside from '../components/AppAside.vue'
import AppToolbar from '../components/AppToolbar.vue'
import PlayerBar from '../components/PlayerBar.vue'

const KEEP_ALIVE = ['SearchView', 'PlaylistsView', 'DownloadView', 'SettingsView']
</script>

<template>
  <div class="shell">
    <AppAside class="area-aside" />
    <div class="area-main">
      <AppToolbar />
      <main class="view scroll">
        <RouterView v-slot="{ Component }">
          <KeepAlive :include="KEEP_ALIVE">
            <component :is="Component" />
          </KeepAlive>
        </RouterView>
      </main>
      <PlayerBar />
    </div>
  </div>
</template>

<style scoped>
/* 窄图标侧栏（透出浅色 app-background）| 白色主区（LX 布局） */
.shell {
  display: flex;
  height: 100vh;
  background-color: var(--color-app-background);
}
.area-aside {
  flex: none;
  width: var(--width-aside);
}
.area-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background-color: var(--color-main-background);
}
.view {
  flex: 1;
  min-height: 0;
}
</style>
