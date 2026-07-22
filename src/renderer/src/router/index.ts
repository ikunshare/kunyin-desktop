import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router'
import MainLayout from '../layouts/MainLayout.vue'

/**
 * 路由对照 Android 端 Screen.kt：
 * search · player/:songId · playlist/:playlistId · album/:albumKey
 * · artist/:artistKey · lyrics · local_playlist/:type · download（+ settings）
 *
 * 4 个主 Tab（search/playlists/download/settings）作为 MainLayout 的子路由并 keep-alive；
 * 详情页共享外壳；player 为全屏顶层路由（覆盖外壳，垂直呼出）。
 */
const routes: RouteRecordRaw[] = [
  {
    path: '/',
    component: MainLayout,
    children: [
      { path: '', redirect: '/search' },
      { path: 'search', name: 'search', component: () => import('../views/SearchView.vue') },
      {
        path: 'playlists',
        name: 'playlists',
        component: () => import('../views/PlaylistsView.vue')
      },
      { path: 'download', name: 'download', component: () => import('../views/DownloadView.vue') },
      { path: 'settings', name: 'settings', component: () => import('../views/SettingsView.vue') },
      {
        path: 'playlist/:playlistId',
        name: 'playlist',
        component: () => import('../views/PlaylistView.vue')
      },
      { path: 'album/:albumKey', name: 'album', component: () => import('../views/AlbumView.vue') },
      {
        path: 'artist/:artistKey',
        name: 'artist',
        component: () => import('../views/ArtistView.vue')
      },
      {
        path: 'local/:type',
        name: 'localPlaylist',
        component: () => import('../views/LocalPlaylistView.vue')
      }
    ]
  },
  {
    path: '/player/:songId?',
    name: 'player',
    component: () => import('../views/PlayerView.vue')
  }
]

export const router = createRouter({
  history: createWebHashHistory(),
  routes
})
