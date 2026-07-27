/**
 * 本地曲库 IPC —— 分发到 store/library.ts。
 * 写操作后由 library 的 onLibraryChange 回调广播 LIBRARY_CHANGED，渲染层重拉。
 */
import {
  IpcChannels,
  type LocalPlaylist,
  type MusicItem,
  type PlaylistSortField,
  type PlaylistSortOrder
} from '@common'
import { handle, sendToRenderer } from '../helpers'
import * as library from '../../store/library'
import { parseLocalSong, pickLocalSongs } from '../../modules/local-music'

let wired = false

export function registerLibraryHandlers(): void {
  library.initLibrary()

  // 变更广播（等价 Android 的 playlistsFlow / favoritesFlow）
  if (!wired) {
    library.onLibraryChange(() => sendToRenderer(IpcChannels.LIBRARY_CHANGED))
    wired = true
  }

  handle(IpcChannels.LIBRARY_PLAYLISTS, (): LocalPlaylist[] => library.getPlaylists())
  handle(
    IpcChannels.LIBRARY_PLAYLIST_SONGS,
    (playlistId: number, limit?: number, offset?: number): MusicItem[] =>
      library.queryPlaylistSongs(playlistId, limit, offset)
  )
  handle(
    IpcChannels.LIBRARY_CREATE_PLAYLIST,
    (name: string, opts?: { remoteSource?: string; remoteId?: string; autoRefresh?: boolean }) =>
      library.createPlaylist(name, opts)
  )
  handle(IpcChannels.LIBRARY_DELETE_PLAYLIST, (playlistId: number) =>
    library.deletePlaylist(playlistId)
  )
  handle(IpcChannels.LIBRARY_RENAME_PLAYLIST, (playlistId: number, newName: string) =>
    library.renamePlaylist(playlistId, newName)
  )
  handle(IpcChannels.LIBRARY_ADD_TO_PLAYLIST, (playlistId: number, item: MusicItem) =>
    library.addToPlaylist(playlistId, item)
  )
  handle(IpcChannels.LIBRARY_REMOVE_FROM_PLAYLIST, (playlistId: number, item: MusicItem) =>
    library.removeFromPlaylist(playlistId, item)
  )
  handle(
    IpcChannels.LIBRARY_MOVE_SONG,
    (playlistId: number, item: MusicItem, newPosition: number) =>
      library.moveSongInPlaylist(playlistId, item, newPosition)
  )
  handle(IpcChannels.LIBRARY_MOVE_PLAYLIST, (playlistId: number, targetIndex: number) =>
    library.movePlaylist(playlistId, targetIndex)
  )
  handle(IpcChannels.LIBRARY_IS_FAVORITE, (item: MusicItem): boolean => library.isFavorite(item))
  handle(IpcChannels.LIBRARY_TOGGLE_FAVORITE, (item: MusicItem): boolean =>
    library.toggleFavorite(item)
  )
  handle(IpcChannels.LIBRARY_ADD_TO_TRIAL, (item: MusicItem, atHead: boolean) =>
    library.addToTrial(item, atHead)
  )
  handle(IpcChannels.LIBRARY_TRIAL_SONGS, (): MusicItem[] => library.queryTrialSongs())
  // 歌词/封面重定向（对应安卓 LocalMusicStore 的 getRedirect/setRedirect/clearRedirect）
  handle(
    IpcChannels.LIBRARY_GET_REDIRECT,
    (item: MusicItem): MusicItem | null => library.getRedirect(item) ?? null
  )
  handle(IpcChannels.LIBRARY_SET_REDIRECT, (item: MusicItem, target: MusicItem) =>
    library.setRedirect(item, target)
  )
  handle(IpcChannels.LIBRARY_CLEAR_REDIRECT, (item: MusicItem) => library.clearRedirect(item))
  handle(
    IpcChannels.LIBRARY_SORT_SONGS,
    (playlistId: number, field: PlaylistSortField, order: PlaylistSortOrder) =>
      library.sortPlaylistSongs(playlistId, field, order)
  )
  handle(IpcChannels.LIBRARY_REPLACE_SONGS, (playlistId: number, items: MusicItem[]) =>
    library.replacePlaylistSongs(playlistId, items)
  )
  // 添加本地歌曲：弹文件框 → 解析标签 → 逐首入歌单；返回统计（null=用户取消）
  handle(
    IpcChannels.LIBRARY_ADD_LOCAL_SONGS,
    async (playlistId: number): Promise<{ added: number; skipped: number } | null> => {
      const paths = await pickLocalSongs()
      if (!paths) return null
      let added = 0
      let skipped = 0
      const before = new Set(library.queryPlaylistSongs(playlistId).map((m) => `${m.id}_${m.type}`))
      for (const p of paths) {
        try {
          const item = await parseLocalSong(p)
          if (before.has(`${item.id}_${item.type}`)) {
            skipped++
            continue
          }
          library.addToPlaylist(playlistId, item)
          added++
        } catch {
          skipped++
        }
      }
      return { added, skipped }
    }
  )
}
