/**
 * 本地曲库 IPC —— 分发到 store/library.ts。
 * 写操作后由 library 的 onLibraryChange 回调广播 LIBRARY_CHANGED，渲染层重拉。
 */
import { IpcChannels, type LocalPlaylist, type MusicItem } from '@common'
import { handle, sendToRenderer } from '../helpers'
import * as library from '../../store/library'

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
}
