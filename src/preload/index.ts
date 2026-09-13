import { contextBridge, ipcRenderer } from 'electron'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { electronAPI } from '@electron-toolkit/preload'
import {
  IpcChannels,
  type AppSettings,
  type DesktopLyricState,
  type MediaCommand,
  type PlatformSongsProgress,
  type QQQRStatusEvent,
  type QQWebLoginEvent,
  type SyncStatusSnapshot,
  type UpdaterEvent,
  type WindowApi
} from '@common'

// 渲染层常把 Pinia 响应式 Proxy（MusicItem）传进来；Proxy 无法被 structuredClone
// （ipcRenderer.invoke 的序列化），会抛 DataCloneError。过 IPC 前统一转普通对象。
function toPlain<T>(v: T): T {
  return v == null ? v : (JSON.parse(JSON.stringify(v)) as T)
}

// 暴露给渲染层的类型化能力面。渲染层不直接触网，一切走此处转发到主进程。
const api: WindowApi = {
  app: {
    getVersion: () => ipcRenderer.invoke(IpcChannels.APP_VERSION),
    getPlatform: () => ipcRenderer.invoke(IpcChannels.APP_PLATFORM)
  },
  window: {
    minimize: () => ipcRenderer.invoke(IpcChannels.WINDOW_MINIMIZE),
    close: () => ipcRenderer.invoke(IpcChannels.WINDOW_CLOSE),
    fullscreen: (enabled) => ipcRenderer.invoke(IpcChannels.WINDOW_FULLSCREEN, enabled),
    onFullscreenChange: (cb) => {
      const listener = (_e: Electron.IpcRendererEvent, fullscreen: boolean): void => cb(fullscreen)
      ipcRenderer.on(IpcChannels.WINDOW_FULLSCREEN_CHANGED, listener)
      return () => {
        ipcRenderer.off(IpcChannels.WINDOW_FULLSCREEN_CHANGED, listener)
      }
    },
    setSize: (width, height) => ipcRenderer.invoke(IpcChannels.WINDOW_SET_SIZE, width, height),
    ready: () => ipcRenderer.send(IpcChannels.WINDOW_READY)
  },
  settings: {
    get: () => ipcRenderer.invoke(IpcChannels.SETTINGS_GET),
    set: (patch) => ipcRenderer.invoke(IpcChannels.SETTINGS_SET, patch),
    onChange: (cb) => {
      const listener = (_e: Electron.IpcRendererEvent, settings: AppSettings): void => cb(settings)
      ipcRenderer.on(IpcChannels.SETTINGS_CHANGED, listener)
      return () => {
        ipcRenderer.off(IpcChannels.SETTINGS_CHANGED, listener)
      }
    },
    proxyStatus: () => ipcRenderer.invoke(IpcChannels.SETTINGS_PROXY_STATUS)
  },
  cache: {
    stats: () => ipcRenderer.invoke(IpcChannels.CACHE_STATS),
    clear: (kind) => ipcRenderer.invoke(IpcChannels.CACHE_CLEAR, kind)
  },
  log: {
    // send 而非 invoke：日志是高频 fire-and-forget，不该让调用方等回执
    write: (entry) => ipcRenderer.send(IpcChannels.LOG_WRITE, toPlain(entry)),
    info: () => ipcRenderer.invoke(IpcChannels.LOG_INFO),
    recent: (limit) => ipcRenderer.invoke(IpcChannels.LOG_RECENT, limit),
    dump: () => ipcRenderer.invoke(IpcChannels.LOG_DUMP),
    openDir: () => ipcRenderer.invoke(IpcChannels.LOG_OPEN_DIR),
    toggleDevTools: () => ipcRenderer.invoke(IpcChannels.DEVTOOLS_TOGGLE)
  },
  search: {
    songs: (source, keyword, page, size) =>
      ipcRenderer.invoke(IpcChannels.SEARCH_SONGS, source, keyword, page, size),
    hot: (source) => ipcRenderer.invoke(IpcChannels.SEARCH_HOT, source),
    tip: (source, keyword) => ipcRenderer.invoke(IpcChannels.SEARCH_TIP, source, keyword)
  },
  player: {
    resolveUrl: (item, qualityId) =>
      ipcRenderer.invoke(IpcChannels.PLAYER_RESOLVE_URL, toPlain(item), qualityId),
    stream: (item, qualityId) =>
      ipcRenderer.invoke(IpcChannels.PLAYER_STREAM, toPlain(item), qualityId),
    lyric: (item) => ipcRenderer.invoke(IpcChannels.PLAYER_LYRIC, toPlain(item)),
    invalidateUrl: (item, qualityId) =>
      ipcRenderer.invoke(IpcChannels.PLAYER_URL_INVALIDATE, toPlain(item), qualityId),
    qqReport: (event) => ipcRenderer.invoke(IpcChannels.PLAYER_QQ_REPORT, toPlain(event))
  },
  comment: {
    supported: (source) => ipcRenderer.invoke(IpcChannels.COMMENT_SUPPORTED, source),
    latest: (item, page, limit) =>
      ipcRenderer.invoke(IpcChannels.COMMENT_NEW, toPlain(item), page, limit),
    hot: (item, page, limit) =>
      ipcRenderer.invoke(IpcChannels.COMMENT_HOT, toPlain(item), page, limit)
  },
  auth: {
    get: () => ipcRenderer.invoke(IpcChannels.AUTH_GET),
    validate: (authst) => ipcRenderer.invoke(IpcChannels.AUTH_VALIDATE, authst),
    clear: () => ipcRenderer.invoke(IpcChannels.AUTH_CLEAR)
  },
  library: {
    refreshRemote: (id) => ipcRenderer.invoke(IpcChannels.LIBRARY_REFRESH_REMOTE, id),
    setAutoRefresh: (id, enabled) =>
      ipcRenderer.invoke(IpcChannels.LIBRARY_AUTO_REFRESH, id, enabled),
    importRemote: (source, id, name, chart, period) =>
      ipcRenderer.invoke(IpcChannels.LIBRARY_IMPORT_REMOTE, source, id, name, chart, period),
    playlists: () => ipcRenderer.invoke(IpcChannels.LIBRARY_PLAYLISTS),
    playlistSongs: (playlistId, limit, offset) =>
      ipcRenderer.invoke(IpcChannels.LIBRARY_PLAYLIST_SONGS, playlistId, limit, offset),
    createPlaylist: (name, opts) =>
      ipcRenderer.invoke(IpcChannels.LIBRARY_CREATE_PLAYLIST, name, opts),
    deletePlaylist: (playlistId) =>
      ipcRenderer.invoke(IpcChannels.LIBRARY_DELETE_PLAYLIST, playlistId),
    renamePlaylist: (playlistId, newName) =>
      ipcRenderer.invoke(IpcChannels.LIBRARY_RENAME_PLAYLIST, playlistId, newName),
    addToPlaylist: (playlistId, item) =>
      ipcRenderer.invoke(IpcChannels.LIBRARY_ADD_TO_PLAYLIST, playlistId, toPlain(item)),
    removeFromPlaylist: (playlistId, item) =>
      ipcRenderer.invoke(IpcChannels.LIBRARY_REMOVE_FROM_PLAYLIST, playlistId, toPlain(item)),
    moveSong: (playlistId, item, newPosition) =>
      ipcRenderer.invoke(IpcChannels.LIBRARY_MOVE_SONG, playlistId, toPlain(item), newPosition),
    movePlaylist: (playlistId, targetIndex) =>
      ipcRenderer.invoke(IpcChannels.LIBRARY_MOVE_PLAYLIST, playlistId, targetIndex),
    isFavorite: (item) => ipcRenderer.invoke(IpcChannels.LIBRARY_IS_FAVORITE, toPlain(item)),
    toggleFavorite: (item) =>
      ipcRenderer.invoke(IpcChannels.LIBRARY_TOGGLE_FAVORITE, toPlain(item)),
    addToTrial: (item, atHead) =>
      ipcRenderer.invoke(IpcChannels.LIBRARY_ADD_TO_TRIAL, toPlain(item), atHead),
    trialSongs: () => ipcRenderer.invoke(IpcChannels.LIBRARY_TRIAL_SONGS),
    sortSongs: (playlistId, field, order) =>
      ipcRenderer.invoke(IpcChannels.LIBRARY_SORT_SONGS, playlistId, field, order),
    replaceSongs: (playlistId, items) =>
      ipcRenderer.invoke(IpcChannels.LIBRARY_REPLACE_SONGS, playlistId, items.map(toPlain)),
    addLocalSongs: (playlistId) =>
      ipcRenderer.invoke(IpcChannels.LIBRARY_ADD_LOCAL_SONGS, playlistId),
    getRedirect: (item) => ipcRenderer.invoke(IpcChannels.LIBRARY_GET_REDIRECT, toPlain(item)),
    setRedirect: (item, target) =>
      ipcRenderer.invoke(IpcChannels.LIBRARY_SET_REDIRECT, toPlain(item), toPlain(target)),
    clearRedirect: (item) => ipcRenderer.invoke(IpcChannels.LIBRARY_CLEAR_REDIRECT, toPlain(item)),
    onChange: (cb) => {
      const listener = (): void => cb()
      ipcRenderer.on(IpcChannels.LIBRARY_CHANGED, listener)
      return () => {
        ipcRenderer.off(IpcChannels.LIBRARY_CHANGED, listener)
      }
    }
  },
  discover: {
    charts: (source) => ipcRenderer.invoke(IpcChannels.DISCOVER_CHARTS, source),
    chartSongs: (source, id, page, size, period) =>
      ipcRenderer.invoke(IpcChannels.DISCOVER_CHART_SONGS, source, id, page, size, period),
    categories: (source) => ipcRenderer.invoke(IpcChannels.DISCOVER_CATEGORIES, source),
    playlists: (source, category, order, page, size) =>
      ipcRenderer.invoke(IpcChannels.DISCOVER_PLAYLISTS, source, category, order, page, size),
    playlistInfo: (source, input) =>
      ipcRenderer.invoke(IpcChannels.DISCOVER_PLAYLIST_INFO, source, input),
    playlistSongs: (source, id, page, size) =>
      ipcRenderer.invoke(IpcChannels.DISCOVER_PLAYLIST_SONGS, source, id, page, size),
    albumInfo: (source, id) => ipcRenderer.invoke(IpcChannels.DISCOVER_ALBUM_INFO, source, id),
    albumSongs: (source, id, page, size) =>
      ipcRenderer.invoke(IpcChannels.DISCOVER_ALBUM_SONGS, source, id, page, size),
    artistInfo: (source, id) => ipcRenderer.invoke(IpcChannels.DISCOVER_ARTIST_INFO, source, id),
    artistSongs: (source, id, page, size) =>
      ipcRenderer.invoke(IpcChannels.DISCOVER_ARTIST_SONGS, source, id, page, size),
    artistAlbums: (source, id, page, size) =>
      ipcRenderer.invoke(IpcChannels.DISCOVER_ARTIST_ALBUMS, source, id, page, size),
    artistMvs: (source, id, page, size) =>
      ipcRenderer.invoke(IpcChannels.DISCOVER_ARTIST_MVS, source, id, page, size),
    artistCaps: (source) => ipcRenderer.invoke(IpcChannels.DISCOVER_ARTIST_CAPS, source),
    artistMvItem: (source, vid, title, cover) =>
      ipcRenderer.invoke(IpcChannels.DISCOVER_ARTIST_MV_ITEM, source, vid, title, cover),
    searchAlbum: (source, keyword, page, size) =>
      ipcRenderer.invoke(IpcChannels.DISCOVER_SEARCH_ALBUM, source, keyword, page, size),
    searchArtist: (source, keyword, page, size) =>
      ipcRenderer.invoke(IpcChannels.DISCOVER_SEARCH_ARTIST, source, keyword, page, size),
    searchPlaylist: (source, keyword, page, size) =>
      ipcRenderer.invoke(IpcChannels.DISCOVER_SEARCH_PLAYLIST, source, keyword, page, size),
    userPlaylists: (source) => ipcRenderer.invoke(IpcChannels.DISCOVER_USER_PLAYLISTS, source),
    mvQualities: (item) =>
      ipcRenderer.invoke(IpcChannels.DISCOVER_MV_QUALITIES, item.type, toPlain(item)),
    mvUrl: (item, quality) =>
      ipcRenderer.invoke(IpcChannels.DISCOVER_MV_URL, item.type, toPlain(item), quality)
  },
  redirect: {
    lookup: (source, key, value) =>
      ipcRenderer.invoke(IpcChannels.REDIRECT_LOOKUP, source, key, value),
    kgSearch: (keyword, durationMs) =>
      ipcRenderer.invoke(IpcChannels.REDIRECT_KG_SEARCH, keyword, durationMs)
  },
  media: {
    shortcutStatus: () => ipcRenderer.invoke(IpcChannels.MEDIA_SHORTCUT_STATUS),
    onCommand: (cb) => {
      const listener = (_e: Electron.IpcRendererEvent, cmd: MediaCommand): void => cb(cmd)
      ipcRenderer.on(IpcChannels.MEDIA_COMMAND, listener)
      return () => {
        ipcRenderer.off(IpcChannels.MEDIA_COMMAND, listener)
      }
    },
    setState: (playing) => ipcRenderer.send(IpcChannels.MEDIA_SET_STATE, playing)
  },
  desktopLyric: {
    toggle: (enabled) => ipcRenderer.invoke(IpcChannels.DESKTOP_LYRIC_TOGGLE, enabled),
    push: (state) => ipcRenderer.send(IpcChannels.DESKTOP_LYRIC_PUSH, state),
    onState: (cb) => {
      const listener = (_e: Electron.IpcRendererEvent, state: DesktopLyricState): void => cb(state)
      ipcRenderer.on(IpcChannels.DESKTOP_LYRIC_STATE, listener)
      return () => {
        ipcRenderer.off(IpcChannels.DESKTOP_LYRIC_STATE, listener)
      }
    },
    setLock: (locked) => ipcRenderer.send(IpcChannels.DESKTOP_LYRIC_SET_LOCK, locked),
    seek: (ms) => ipcRenderer.send(IpcChannels.DESKTOP_LYRIC_SEEK, ms),
    onSeekRequest: (cb) => {
      const listener = (_e: Electron.IpcRendererEvent, ms: number): void => cb(ms)
      ipcRenderer.on(IpcChannels.DESKTOP_LYRIC_SEEK_REQUEST, listener)
      return () => {
        ipcRenderer.off(IpcChannels.DESKTOP_LYRIC_SEEK_REQUEST, listener)
      }
    }
  },
  download: {
    add: (input) =>
      ipcRenderer.invoke(IpcChannels.DOWNLOAD_ADD, { ...input, item: toPlain(input.item) }),
    list: () => ipcRenderer.invoke(IpcChannels.DOWNLOAD_LIST),
    pause: (taskKey) => ipcRenderer.invoke(IpcChannels.DOWNLOAD_PAUSE, taskKey),
    resume: (taskKey) => ipcRenderer.invoke(IpcChannels.DOWNLOAD_RESUME, taskKey),
    retry: (taskKey) => ipcRenderer.invoke(IpcChannels.DOWNLOAD_RETRY, taskKey),
    remove: (taskKey, deleteFile) =>
      ipcRenderer.invoke(IpcChannels.DOWNLOAD_REMOVE, taskKey, deleteFile),
    clearCompleted: () => ipcRenderer.invoke(IpcChannels.DOWNLOAD_CLEAR_COMPLETED),
    onChange: (cb) => {
      const listener = (): void => cb()
      ipcRenderer.on(IpcChannels.DOWNLOAD_CHANGED, listener)
      return () => {
        ipcRenderer.off(IpcChannels.DOWNLOAD_CHANGED, listener)
      }
    }
  },
  shell: {
    selectDirectory: (defaultPath) =>
      ipcRenderer.invoke(IpcChannels.DIALOG_SELECT_DIRECTORY, defaultPath),
    openPath: (path) => ipcRenderer.invoke(IpcChannels.SHELL_OPEN_PATH, path)
  },
  account: {
    list: () => ipcRenderer.invoke(IpcChannels.ACCOUNT_LIST),
    logout: (provider) => ipcRenderer.invoke(IpcChannels.ACCOUNT_LOGOUT, provider),
    kgSave: (creds) => ipcRenderer.invoke(IpcChannels.ACCOUNT_KG_SAVE, creds),
    kgQrCreate: () => ipcRenderer.invoke(IpcChannels.ACCOUNT_KG_QR_CREATE),
    kgQrPoll: (ticket) => ipcRenderer.invoke(IpcChannels.ACCOUNT_KG_QR_POLL, ticket),
    kgQrStop: () => ipcRenderer.invoke(IpcChannels.ACCOUNT_KG_QR_STOP),
    wyQrCreate: () => ipcRenderer.invoke(IpcChannels.ACCOUNT_WY_QR_CREATE),
    wyQrPoll: (unikey) => ipcRenderer.invoke(IpcChannels.ACCOUNT_WY_QR_POLL, unikey),
    qqQrStart: () => ipcRenderer.invoke(IpcChannels.ACCOUNT_QQ_QR_START),
    qqQrStop: () => ipcRenderer.invoke(IpcChannels.ACCOUNT_QQ_QR_STOP),
    onQQEvent: (cb) => {
      const listener = (_e: Electron.IpcRendererEvent, evt: QQQRStatusEvent): void => cb(evt)
      ipcRenderer.on(IpcChannels.ACCOUNT_QQ_QR_EVENT, listener)
      return () => {
        ipcRenderer.off(IpcChannels.ACCOUNT_QQ_QR_EVENT, listener)
      }
    },
    qqWebOpen: () => ipcRenderer.invoke(IpcChannels.ACCOUNT_QQ_WEB_OPEN),
    qqWebFinish: () => ipcRenderer.invoke(IpcChannels.ACCOUNT_QQ_WEB_FINISH),
    qqWebClose: () => ipcRenderer.invoke(IpcChannels.ACCOUNT_QQ_WEB_CLOSE),
    onQQWebEvent: (cb) => {
      const listener = (_e: Electron.IpcRendererEvent, evt: QQWebLoginEvent): void => cb(evt)
      ipcRenderer.on(IpcChannels.ACCOUNT_QQ_WEB_EVENT, listener)
      return () => {
        ipcRenderer.off(IpcChannels.ACCOUNT_QQ_WEB_EVENT, listener)
      }
    },
    onChange: (cb) => {
      const listener = (): void => cb()
      ipcRenderer.on(IpcChannels.ACCOUNT_CHANGED, listener)
      return () => {
        ipcRenderer.off(IpcChannels.ACCOUNT_CHANGED, listener)
      }
    }
  },
  platform: {
    sections: () => ipcRenderer.invoke(IpcChannels.PLATFORM_SECTIONS),
    refresh: (source, force) => ipcRenderer.invoke(IpcChannels.PLATFORM_REFRESH, source, force),
    songs: (source, id, force) => ipcRenderer.invoke(IpcChannels.PLATFORM_SONGS, source, id, force),
    onSongsProgress: (cb) => {
      const listener = (_e: Electron.IpcRendererEvent, p: PlatformSongsProgress): void => cb(p)
      ipcRenderer.on(IpcChannels.PLATFORM_SONGS_PROGRESS, listener)
      return () => {
        ipcRenderer.off(IpcChannels.PLATFORM_SONGS_PROGRESS, listener)
      }
    },
    onChange: (cb) => {
      const listener = (): void => cb()
      ipcRenderer.on(IpcChannels.PLATFORM_CHANGED, listener)
      return () => {
        ipcRenderer.off(IpcChannels.PLATFORM_CHANGED, listener)
      }
    }
  },
  sync: {
    status: () => ipcRenderer.invoke(IpcChannels.SYNC_STATUS),
    connect: () => ipcRenderer.invoke(IpcChannels.SYNC_CONNECT),
    disconnect: () => ipcRenderer.invoke(IpcChannels.SYNC_DISCONNECT),
    reset: () => ipcRenderer.invoke(IpcChannels.SYNC_RESET),
    onStatus: (cb) => {
      const listener = (_e: Electron.IpcRendererEvent, s: SyncStatusSnapshot): void => cb(s)
      ipcRenderer.on(IpcChannels.SYNC_STATUS_CHANGED, listener)
      return () => {
        ipcRenderer.off(IpcChannels.SYNC_STATUS_CHANGED, listener)
      }
    }
  },
  backup: {
    exportFull: (filePath) => ipcRenderer.invoke(IpcChannels.BACKUP_EXPORT_FULL, filePath),
    exportPlaylists: (filePath, opts) =>
      ipcRenderer.invoke(IpcChannels.BACKUP_EXPORT_PLAYLISTS, filePath, opts),
    parse: (filePath) => ipcRenderer.invoke(IpcChannels.BACKUP_PARSE, filePath),
    restore: (filePath, options) =>
      ipcRenderer.invoke(IpcChannels.BACKUP_RESTORE, filePath, options),
    lxParse: (filePath) => ipcRenderer.invoke(IpcChannels.BACKUP_LX_PARSE, filePath),
    lxImport: (filePath) => ipcRenderer.invoke(IpcChannels.BACKUP_LX_IMPORT, filePath),
    pickSave: (defaultName) => ipcRenderer.invoke(IpcChannels.BACKUP_PICK_SAVE, defaultName),
    pickOpen: (filters) => ipcRenderer.invoke(IpcChannels.BACKUP_PICK_OPEN, filters)
  },
  updater: {
    check: () => ipcRenderer.invoke(IpcChannels.UPDATER_CHECK),
    download: () => ipcRenderer.invoke(IpcChannels.UPDATER_DOWNLOAD),
    install: () => ipcRenderer.invoke(IpcChannels.UPDATER_INSTALL),
    onEvent: (cb) => {
      const listener = (_e: Electron.IpcRendererEvent, evt: UpdaterEvent): void => cb(evt)
      ipcRenderer.on(IpcChannels.UPDATER_EVENT, listener)
      return () => {
        ipcRenderer.off(IpcChannels.UPDATER_EVENT, listener)
      }
    }
  }
}

// 首屏主题防闪烁：同步读取 settings.json 的外观段，渲染层在 mount 前即可注入正确主题变量。
// 读不到（首次启动）时为 null，渲染层回退默认绿色主题。
function readInitialAppearance(): AppSettings['appearance'] | null {
  try {
    // 主进程返回的是应用数据目录 userData/data/（settings.json 在其中）
    const dataPath = ipcRenderer.sendSync(IpcChannels.APP_USERDATA_PATH) as string
    const raw = readFileSync(join(dataPath, 'settings.json'), 'utf-8')
    return (JSON.parse(raw) as AppSettings).appearance ?? null
  } catch {
    return null
  }
}
const initialAppearance = readInitialAppearance()

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
    contextBridge.exposeInMainWorld('__INITIAL_APPEARANCE__', initialAppearance)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
  // @ts-ignore (define in dts)
  window.__INITIAL_APPEARANCE__ = initialAppearance
}
