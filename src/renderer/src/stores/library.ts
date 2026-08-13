import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { LocalPlaylist, MusicItem } from '@common'
import { usePlayerStore } from './player'

/**
 * 本地曲库状态（收藏 / 试听「最近播放」/ 自建歌单）。
 * 数据全在主进程 SQLite；此 store 缓存歌单列表与收藏判定，随主进程 LIBRARY_CHANGED 广播刷新。
 */
export const useLibraryStore = defineStore('library', () => {
  const playlists = ref<LocalPlaylist[]>([])
  /** 收藏歌曲的 uniqueKey 集合（`id_type`），用于按钮态快速判定 */
  const favoriteKeys = ref<Set<string>>(new Set())

  function keyOf(item: MusicItem): string {
    return `${item.id}_${item.type}`
  }
  /** contextBridge 无法克隆 Pinia 响应式 Proxy，过 IPC 前转普通对象 */
  function plain(item: MusicItem): MusicItem {
    return JSON.parse(JSON.stringify(item)) as MusicItem
  }

  async function loadPlaylists(): Promise<void> {
    playlists.value = await window.api.library.playlists()
  }

  /** 拉取「我的收藏」全部歌曲并重建 favoriteKeys（用于列表按钮态） */
  async function refreshFavorites(): Promise<void> {
    const fav = playlists.value.find((p) => p.systemKind === 'favorites')
    if (!fav) {
      favoriteKeys.value = new Set()
      return
    }
    const songs = await window.api.library.playlistSongs(fav.id)
    favoriteKeys.value = new Set(songs.map(keyOf))
  }

  async function refresh(): Promise<void> {
    await loadPlaylists()
    await refreshFavorites()
  }

  function isFavorite(item: MusicItem): boolean {
    return favoriteKeys.value.has(keyOf(item))
  }

  async function toggleFavorite(item: MusicItem): Promise<boolean> {
    const now = await window.api.library.toggleFavorite(plain(item))
    // 乐观更新本地集合（广播回来会再校准）
    const k = keyOf(item)
    const next = new Set(favoriteKeys.value)
    if (now) next.add(k)
    else next.delete(k)
    favoriteKeys.value = next
    return now
  }

  async function createPlaylist(name: string): Promise<number> {
    const id = await window.api.library.createPlaylist(name)
    await loadPlaylists()
    return id
  }

  async function deletePlaylist(playlistId: number): Promise<void> {
    await window.api.library.deletePlaylist(playlistId)
    await loadPlaylists()
  }

  async function renamePlaylist(playlistId: number, newName: string): Promise<void> {
    await window.api.library.renamePlaylist(playlistId, newName)
    await loadPlaylists()
  }

  /** 重排自建歌单顺序（左栏拖拽），targetIndex 为在自建歌单序列中的目标位置 */
  async function movePlaylist(playlistId: number, targetIndex: number): Promise<void> {
    await window.api.library.movePlaylist(playlistId, targetIndex)
    await loadPlaylists()
  }

  async function addToPlaylist(playlistId: number, item: MusicItem): Promise<void> {
    await window.api.library.addToPlaylist(playlistId, plain(item))
  }

  async function removeFromPlaylist(playlistId: number, item: MusicItem): Promise<void> {
    await window.api.library.removeFromPlaylist(playlistId, plain(item))
    // 从列表删除的歌同步移出播放队列（含正在播放的这首），避免还能切回已删歌曲
    usePlayerStore().removeFromQueue(plain(item))
  }

  async function playlistSongs(playlistId: number): Promise<MusicItem[]> {
    return window.api.library.playlistSongs(playlistId)
  }

  /** 订阅主进程曲库变更，自动刷新歌单与收藏。调用方在挂载时启动、卸载时取消。 */
  function subscribe(): () => void {
    return window.api.library.onChange(() => void refresh())
  }

  return {
    playlists,
    favoriteKeys,
    refresh,
    loadPlaylists,
    refreshFavorites,
    isFavorite,
    toggleFavorite,
    createPlaylist,
    deletePlaylist,
    renamePlaylist,
    movePlaylist,
    addToPlaylist,
    removeFromPlaylist,
    playlistSongs,
    subscribe
  }
})
