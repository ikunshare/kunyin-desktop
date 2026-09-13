<script setup lang="ts">
import { RouterView } from 'vue-router'
import AppAside from '../components/AppAside.vue'
import AppToolbar from '../components/AppToolbar.vue'
import PlayerBar from '../components/PlayerBar.vue'

const KEEP_ALIVE = [
  'SearchView',
  'DiscoverView',
  'ChartsView',
  'PlaylistsView',
  'DownloadView',
  'SettingsView'
]
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
/* 高度用 100%（跟随被 zoom 缩放的 #app），不能用 100vh——vh 是视口单位不随 zoom 缩放，
   字体大小档位改变 zoom 后会与 #app 高度失配，导致底部露白。 */
.shell {
  display: flex;
  height: 100%;
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
  /* LX #right：与侧栏形成层叠分隔 */
  border-top-left-radius: var(--radius-border);
  border-bottom-left-radius: var(--radius-border);
  box-shadow: 0 0 4px rgba(0, 0, 0, 0.1);
  overflow: hidden;
}
.view {
  flex: 1;
  min-height: 0;
}
</style>
