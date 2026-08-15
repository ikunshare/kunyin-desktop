/**
 * 类型安全的 IPC 契约
 *
 * - `IpcChannels`：通道名常量（按域分组，避免撞名）。
 * - `WindowApi`：preload 通过 contextBridge 暴露、渲染层消费的 `window.api` 形状。
 *   主进程按 `IpcChannels` 注册 handler，preload 逐一转发到 `ipcRenderer.invoke`。
 *
 * 各域方法随分阶段实施逐步补齐；Phase 0 先立骨架（app/settings 真实实现，search/player 占位）。
 */
import type { KgLyricCandidate, Lyric, MusicItem, MusicSource } from './music'
import type {
  AlbumInfoResult,
  AlbumSearchResult,
  ArtistCapabilities,
  ArtistInfoResult,
  ArtistMvResult,
  ArtistSearchResult,
  AudioStreamResult,
  MediaInfoResult,
  MusicListResult,
  MvQuality,
  MvUrlResult,
  PlayListInfoResult,
  PlaylistSearchResult
} from './provider'
import type { AppSettings, AuthState, CacheKind, CacheStats, ProxyStatus } from './settings'
import type { LocalPlaylist } from './library'
import type { AddDownloadInput, DownloadTask } from './download'

export const IpcChannels = {
  // 应用
  APP_VERSION: 'app:version',
  APP_PLATFORM: 'app:platform',
  /** 返回应用数据目录 userData/data/（settings.json 等所在处，见 main/core/paths.ts） */
  APP_USERDATA_PATH: 'app:userdata-path',

  // 窗口控制（无边框主窗口）
  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_CLOSE: 'window:close',
  WINDOW_SET_SIZE: 'window:setSize',
  WINDOW_READY: 'window:ready', // 渲染 → 主：UI 首帧已绘制，可显示窗口

  // 设置
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  SETTINGS_CHANGED: 'settings:changed', // 主 → 渲染 事件
  SETTINGS_PROXY_STATUS: 'settings:proxyStatus', // 代理是否真正生效（探活结果）

  // 缓存管理
  CACHE_STATS: 'cache:stats',
  CACHE_CLEAR: 'cache:clear',

  // 搜索
  SEARCH_SONGS: 'search:songs',
  SEARCH_HOT: 'search:hot',
  SEARCH_TIP: 'search:tip',

  // 播放 / 歌词
  PLAYER_RESOLVE_URL: 'player:resolveUrl',
  PLAYER_STREAM: 'player:stream',
  PLAYER_LYRIC: 'player:lyric',
  PLAYER_URL_INVALIDATE: 'player:urlInvalidate',

  // 卡密激活
  AUTH_GET: 'auth:get',
  AUTH_VALIDATE: 'auth:validate',
  AUTH_CLEAR: 'auth:clear',

  // 本地曲库（歌单 / 收藏 / 试听）
  LIBRARY_PLAYLISTS: 'library:playlists',
  LIBRARY_PLAYLIST_SONGS: 'library:playlistSongs',
  LIBRARY_CREATE_PLAYLIST: 'library:createPlaylist',
  LIBRARY_DELETE_PLAYLIST: 'library:deletePlaylist',
  LIBRARY_RENAME_PLAYLIST: 'library:renamePlaylist',
  LIBRARY_ADD_TO_PLAYLIST: 'library:addToPlaylist',
  LIBRARY_REMOVE_FROM_PLAYLIST: 'library:removeFromPlaylist',
  LIBRARY_MOVE_SONG: 'library:moveSong',
  LIBRARY_MOVE_PLAYLIST: 'library:movePlaylist',
  LIBRARY_IS_FAVORITE: 'library:isFavorite',
  LIBRARY_TOGGLE_FAVORITE: 'library:toggleFavorite',
  LIBRARY_ADD_TO_TRIAL: 'library:addToTrial',
  LIBRARY_TRIAL_SONGS: 'library:trialSongs',
  LIBRARY_SORT_SONGS: 'library:sortSongs',
  LIBRARY_REPLACE_SONGS: 'library:replaceSongs',
  LIBRARY_ADD_LOCAL_SONGS: 'library:addLocalSongs',
  LIBRARY_GET_REDIRECT: 'library:getRedirect',
  LIBRARY_SET_REDIRECT: 'library:setRedirect',
  LIBRARY_CLEAR_REDIRECT: 'library:clearRedirect',
  LIBRARY_CHANGED: 'library:changed', // 主 → 渲染 事件

  // 歌词/封面重定向查询（对话框用）
  REDIRECT_LOOKUP: 'redirect:lookup',
  REDIRECT_KG_SEARCH: 'redirect:kgSearch',

  // 发现（走 Provider：歌单/专辑/歌手 详情 + 搜索）
  DISCOVER_PLAYLIST_INFO: 'discover:playlistInfo',
  DISCOVER_PLAYLIST_SONGS: 'discover:playlistSongs',
  DISCOVER_ALBUM_INFO: 'discover:albumInfo',
  DISCOVER_ALBUM_SONGS: 'discover:albumSongs',
  DISCOVER_ARTIST_INFO: 'discover:artistInfo',
  DISCOVER_ARTIST_SONGS: 'discover:artistSongs',
  DISCOVER_ARTIST_ALBUMS: 'discover:artistAlbums',
  DISCOVER_ARTIST_MVS: 'discover:artistMvs',
  DISCOVER_ARTIST_CAPS: 'discover:artistCaps',
  DISCOVER_ARTIST_MV_ITEM: 'discover:artistMvItem',
  DISCOVER_SEARCH_ALBUM: 'discover:searchAlbum',
  DISCOVER_SEARCH_ARTIST: 'discover:searchArtist',
  DISCOVER_SEARCH_PLAYLIST: 'discover:searchPlaylist',
  DISCOVER_USER_PLAYLISTS: 'discover:userPlaylists',
  DISCOVER_MV_QUALITIES: 'discover:mvQualities',
  DISCOVER_MV_URL: 'discover:mvUrl',

  // 系统媒体控制（主 → 渲染 命令：全局媒体键/托盘触发）
  MEDIA_COMMAND: 'media:command',
  /** 渲染 → 主：推送播放状态（用于更新任务栏缩略图工具栏的播放/暂停按钮） */
  MEDIA_SET_STATE: 'media:setState',

  // 桌面歌词悬浮窗
  DESKTOP_LYRIC_TOGGLE: 'desktopLyric:toggle', // 渲染 → 主：开/关窗口
  DESKTOP_LYRIC_PUSH: 'desktopLyric:push', // 主窗口 → 主：推送歌词/进度/播放态
  DESKTOP_LYRIC_STATE: 'desktopLyric:state', // 主 → 歌词窗口：转发状态
  DESKTOP_LYRIC_SET_LOCK: 'desktopLyric:setLock', // 歌词窗口 → 主：锁定（点击穿透）

  // 下载
  DOWNLOAD_ADD: 'download:add',
  DOWNLOAD_LIST: 'download:list',
  DOWNLOAD_PAUSE: 'download:pause',
  DOWNLOAD_RESUME: 'download:resume',
  DOWNLOAD_RETRY: 'download:retry',
  DOWNLOAD_REMOVE: 'download:remove',
  DOWNLOAD_CLEAR_COMPLETED: 'download:clearCompleted',
  DOWNLOAD_CHANGED: 'download:changed', // 主 → 渲染 事件

  // 系统对话框 / Shell（下载路径选择、打开目录等）
  DIALOG_SELECT_DIRECTORY: 'dialog:selectDirectory',
  SHELL_OPEN_PATH: 'shell:openPath',

  // 平台登录 / 账号
  ACCOUNT_LIST: 'account:list', // 各平台登录态
  ACCOUNT_LOGOUT: 'account:logout',
  ACCOUNT_KG_SAVE: 'account:kgSave', // 酷狗手动填凭据
  ACCOUNT_WY_QR_CREATE: 'account:wyQrCreate', // wy 扫码：申请二维码
  ACCOUNT_WY_QR_POLL: 'account:wyQrPoll', // wy 扫码：轮询状态
  ACCOUNT_QQ_QR_START: 'account:qqQrStart', // qq 扫码：申请二维码并起 WS 监听
  ACCOUNT_QQ_QR_STOP: 'account:qqQrStop', // qq 扫码：停止监听
  ACCOUNT_QQ_QR_EVENT: 'account:qqQrEvent', // 主 → 渲染：qq 扫码状态事件
  ACCOUNT_CHANGED: 'account:changed', // 主 → 渲染 事件（登录态变更）

  // LX 同步
  SYNC_STATUS: 'sync:status', // 当前状态快照
  SYNC_CONNECT: 'sync:connect',
  SYNC_DISCONNECT: 'sync:disconnect',
  SYNC_RESET: 'sync:reset', // 清会话（重新 CDK 激活）
  SYNC_STATUS_CHANGED: 'sync:statusChanged', // 主 → 渲染 事件

  // 备份 / 导入
  BACKUP_EXPORT_FULL: 'backup:exportFull',
  BACKUP_EXPORT_PLAYLISTS: 'backup:exportPlaylists',
  BACKUP_PARSE: 'backup:parse',
  BACKUP_RESTORE: 'backup:restore',
  BACKUP_LX_PARSE: 'backup:lxParse',
  BACKUP_LX_IMPORT: 'backup:lxImport',
  BACKUP_PICK_SAVE: 'backup:pickSave', // 选保存路径（返回路径或 null）
  BACKUP_PICK_OPEN: 'backup:pickOpen', // 选打开文件（返回路径或 null）

  // 自动更新
  UPDATER_CHECK: 'updater:check',
  UPDATER_DOWNLOAD: 'updater:download',
  UPDATER_INSTALL: 'updater:install',
  UPDATER_EVENT: 'updater:event' // 主 → 渲染 事件
} as const

export type IpcChannel = (typeof IpcChannels)[keyof typeof IpcChannels]

/** 递归可选，用于 settings.set 的局部更新 */
export type DeepPartial<T> = T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T

/** 取消订阅 */
export type Unsubscribe = () => void

/** 系统媒体命令（全局媒体键 / 托盘 → 渲染层播放器） */
export type MediaCommand = 'playpause' | 'next' | 'prev'

/** 歌单内排序字段（LX 排序歌曲） */
export type PlaylistSortField = 'title' | 'artist' | 'album' | 'duration' | 'source'
/** 歌单内排序方向；random 为随机打乱 */
export type PlaylistSortOrder = 'asc' | 'desc' | 'random'

/** 桌面歌词状态（主窗口 → 歌词窗口，经主进程转发） */
export interface DesktopLyricState {
  /** 是否有歌词（无则显示占位/隐藏） */
  hasLyric: boolean
  /** 主歌词（增强 LRC 或行级 LRC），歌词窗自行用 kit 解析 */
  lyric: string
  translate: string
  roman: string
  /** 当前播放时间（毫秒） */
  currentTime: number
  playing: boolean
  /** Web Audio AnalyserNode 采样的实时频谱，值域 0..1 */
  spectrum: number[]
  /** 当前曲目标题（无歌词时展示） */
  title: string
  /** 供歌词净化识别首行「歌名 - 歌手」元信息 */
  musicName?: string
  musicSinger?: string[]
}

/** LX 同步状态（主 → 渲染） */
export type SyncStatusValue = 'idle' | 'connecting' | 'syncing' | 'connected' | 'failed'
export interface SyncStatusSnapshot {
  status: SyncStatusValue
  error: string | null
  serverName: string
}

/** 备份文件摘要 */
export interface BackupSummary {
  version: number
  type: string
  createdAt: number
  hasSettings: boolean
  favoritesCount: number
  playlistsCount: number
  trialCount: number
}
export interface BackupRestoreOptions {
  restoreSettings: boolean
  restorePlaylists: boolean
}
export interface BackupRestoreResult {
  favoritesAdded: number
  favoritesSkipped: number
  playlistsCreated: number
  songsAdded: number
  songsSkipped: number
  settingsRestored: boolean
}
export interface LxImportSummary {
  playlistsCount: number
  songsCount: number
  detail: string
}
export interface LxImportResult {
  favoritesAdded: number
  trialAdded: number
  playlistsCreated: number
  songsAdded: number
  songsSkipped: number
}

/** 自动更新事件（主 → 渲染） */
export type UpdaterEvent =
  | { type: 'checking' }
  | { type: 'available'; version: string; notes: string }
  | { type: 'not-available' }
  | { type: 'progress'; percent: number }
  | { type: 'downloaded'; version: string }
  | { type: 'error'; message: string }

/** 支持登录的平台 key */
export type AccountProvider = 'qq' | 'wy' | 'kg'

/** 单个平台的登录态 */
export interface AccountStatus {
  provider: AccountProvider
  displayName: string
  /** 是否已登录（本地有凭据） */
  loggedIn: boolean
  /** 登录用户昵称（拿到用户信息时） */
  nickname?: string
  avatar?: string
}

/** 酷狗手动填写的凭据（对应 KgCredentials） */
export interface KgManualCreds {
  userid: string
  token: string
  mid?: string
  dfid?: string
}

/** wy 扫码二维码信息 */
export interface WyQRCode {
  unikey: string
  /** 二维码内容（渲染层用 qrcode 生成图） */
  url: string
}

/** wy 扫码轮询结果 */
export interface WyQRPoll {
  status: 'waiting' | 'scanned' | 'success' | 'expired' | 'error'
}

/** qq 扫码二维码信息 */
export interface QQQRCodeInfo {
  /** 二维码图片 data URL（直接给 <img>） */
  image: string
  qrcodeId: string
}

/** qq 扫码事件（主 → 渲染） */
export interface QQQRStatusEvent {
  qrcodeId: string
  status: 'waiting' | 'scanned' | 'confirmed' | 'timeout' | 'refused' | 'error'
  message: string
}

/**
 * `window.api` 的类型。渲染层通过它调用主进程能力，不直接触网。
 */
export interface WindowApi {
  app: {
    getVersion(): Promise<string>
    getPlatform(): Promise<NodeJS.Platform>
  }

  /** 主窗口控制（无边框固定尺寸窗口的最小化/关闭） */
  window: {
    minimize(): Promise<void>
    close(): Promise<void>
    /** 按档位尺寸调整窗口（设置页窗口尺寸选择） */
    setSize(width: number, height: number): Promise<void>
    /** 通知主进程 UI 首帧已绘制完成，可以显示窗口（防启动闪裸背景图） */
    ready(): void
  }

  settings: {
    get(): Promise<AppSettings>
    /** 局部更新，返回合并后的完整设置 */
    set(patch: DeepPartial<AppSettings>): Promise<AppSettings>
    /** 订阅设置变更（由主进程广播），返回取消订阅函数 */
    onChange(cb: (settings: AppSettings) => void): Unsubscribe
    /** 代理实际生效状态（配了但端口不可达时 active=false，附回落原因） */
    proxyStatus(): Promise<ProxyStatus>
  }

  cache: {
    /** 各类缓存用量 */
    stats(): Promise<CacheStats>
    /** 清理指定缓存，返回清理后的最新用量 */
    clear(kind: CacheKind): Promise<CacheStats>
  }

  search: {
    songs(
      source: MusicSource,
      keyword: string,
      page?: number,
      size?: number
    ): Promise<MusicListResult>
    hot(source: MusicSource): Promise<string[]>
    tip(source: MusicSource, keyword: string): Promise<string[]>
  }

  player: {
    /** 解析播放地址（走自建后端，可能返回 ekey 表示加密流） */
    resolveUrl(item: MusicItem, qualityId: string): Promise<MediaInfoResult>
    /** 解析并注册到本地音频代理，返回可直接喂 <audio> 的 127.0.0.1 URL */
    stream(item: MusicItem, qualityId: string): Promise<AudioStreamResult>
    lyric(item: MusicItem): Promise<Lyric>
    /** 播放失败时上报，使该曲该音质的 URL 缓存失效（下次重新解析） */
    invalidateUrl(item: MusicItem, qualityId: string): Promise<void>
  }

  /** 卡密激活（authst） */
  auth: {
    /** 当前激活状态 */
    get(): Promise<AuthState>
    /** 提交卡密校验并保存，返回最新状态 */
    validate(authst: string): Promise<AuthState>
    /** 清除卡密 */
    clear(): Promise<AuthState>
  }

  /** 本地曲库：歌单 / 收藏 / 试听（最近播放） */
  library: {
    playlists(): Promise<LocalPlaylist[]>
    playlistSongs(playlistId: number, limit?: number, offset?: number): Promise<MusicItem[]>
    createPlaylist(
      name: string,
      opts?: { remoteSource?: string; remoteId?: string; autoRefresh?: boolean }
    ): Promise<number>
    deletePlaylist(playlistId: number): Promise<void>
    renamePlaylist(playlistId: number, newName: string): Promise<void>
    addToPlaylist(playlistId: number, item: MusicItem): Promise<void>
    removeFromPlaylist(playlistId: number, item: MusicItem): Promise<void>
    moveSong(playlistId: number, item: MusicItem, newPosition: number): Promise<void>
    /** 重排自建歌单顺序（左栏拖拽）；targetIndex 为在自建歌单序列中的目标位置 */
    movePlaylist(playlistId: number, targetIndex: number): Promise<void>
    isFavorite(item: MusicItem): Promise<boolean>
    /** 切换收藏，返回切换后是否已收藏 */
    toggleFavorite(item: MusicItem): Promise<boolean>
    /** 加入试听列表（点单曲时累积；atHead=true 头插，否则追加末尾） */
    addToTrial(item: MusicItem, atHead: boolean): Promise<void>
    trialSongs(): Promise<MusicItem[]>
    /** 歌单内歌曲整体排序（LX 排序歌曲），按字段与方向重写 position */
    sortSongs(playlistId: number, field: PlaylistSortField, order: PlaylistSortOrder): Promise<void>
    /** 整体替换歌单曲目（远端歌单「更新」），按传入顺序写 position */
    replaceSongs(playlistId: number, items: MusicItem[]): Promise<void>
    /** 弹文件选择框导入本地歌曲到歌单；返回 null 表示取消 */
    addLocalSongs(playlistId: number): Promise<{ added: number; skipped: number } | null>
    /** 查询歌曲的歌词/封面重定向目标（无则 null） */
    getRedirect(item: MusicItem): Promise<MusicItem | null>
    /** 设置歌词/封面重定向：item 的歌词与封面改用 target 的 */
    setRedirect(item: MusicItem, target: MusicItem): Promise<void>
    clearRedirect(item: MusicItem): Promise<void>
    /** 订阅曲库变更（主进程广播），返回取消订阅 */
    onChange(cb: () => void): Unsubscribe
  }

  /** 歌词/封面重定向的查询（RedirectDialog 用，对应安卓 SongRedirectDialog 的 lookup/kgLyricSearch） */
  redirect: {
    /** 按 id/mid 查单曲（qq 支持 key='mid'，wy/kw 仅 'id'）；查不到返回 null */
    lookup(source: 'qq' | 'wy' | 'kw', key: 'id' | 'mid', value: string): Promise<MusicItem | null>
    /** 酷狗歌词候选搜索（关键词 + 源歌曲时长 ms），带内容类型徽标 */
    kgSearch(keyword: string, durationMs: number): Promise<KgLyricCandidate[]>
  }

  /** 发现：走 Provider 的歌单/专辑/歌手 详情与搜索 */
  discover: {
    playlistInfo(source: MusicSource, input: string): Promise<PlayListInfoResult | null>
    playlistSongs(
      source: MusicSource,
      id: string,
      page?: number,
      size?: number
    ): Promise<MusicListResult>
    albumInfo(source: MusicSource, id: string): Promise<AlbumInfoResult | null>
    albumSongs(
      source: MusicSource,
      id: string,
      page?: number,
      size?: number
    ): Promise<MusicListResult>
    artistInfo(source: MusicSource, id: string): Promise<ArtistInfoResult | null>
    artistSongs(
      source: MusicSource,
      id: string,
      page?: number,
      size?: number
    ): Promise<MusicListResult>
    /** 歌手的专辑列表（仅 supportsArtistAlbums 的音源有数据） */
    artistAlbums(
      source: MusicSource,
      id: string,
      page?: number,
      size?: number
    ): Promise<AlbumSearchResult>
    /** 歌手的 MV 列表（仅 supportsArtistMvs 的音源有数据） */
    artistMvs(
      source: MusicSource,
      id: string,
      page?: number,
      size?: number
    ): Promise<ArtistMvResult>
    /** 歌手页 Tab 可用性（决定是否显示专辑/MV Tab） */
    artistCaps(source: MusicSource): Promise<ArtistCapabilities>
    /** 由 MV 列表条目造可播放的占位 item（交给 MvPlayer 取流） */
    artistMvItem(
      source: MusicSource,
      vid: string,
      title: string,
      cover: string
    ): Promise<MusicItem | null>
    searchAlbum(
      source: MusicSource,
      keyword: string,
      page?: number,
      size?: number
    ): Promise<AlbumSearchResult>
    searchArtist(
      source: MusicSource,
      keyword: string,
      page?: number,
      size?: number
    ): Promise<ArtistSearchResult>
    searchPlaylist(
      source: MusicSource,
      keyword: string,
      page?: number,
      size?: number
    ): Promise<PlaylistSearchResult>
    /** 登录后的「我的歌单」（依赖 provider.credentials，未登录返回空） */
    userPlaylists(source: MusicSource): Promise<PlayListInfoResult[]>
    /** MV 可用清晰度（需 item.mvid，仅 wy/qq 支持） */
    mvQualities(item: MusicItem): Promise<MvQuality[]>
    /** MV 播放地址 */
    mvUrl(item: MusicItem, quality: string): Promise<MvUrlResult>
  }

  /** 系统媒体控制（接收主进程的全局媒体键/托盘命令） */
  media: {
    /** 订阅播放命令（playpause/next/prev），返回取消订阅 */
    onCommand(cb: (cmd: MediaCommand) => void): Unsubscribe
    /** 推送播放状态给主进程（更新任务栏缩略图工具栏的播放/暂停按钮） */
    setState(playing: boolean): void
  }

  /** 桌面歌词悬浮窗 */
  desktopLyric: {
    /** 开/关悬浮窗（主窗口用） */
    toggle(enabled: boolean): Promise<void>
    /** 主窗口推送歌词/进度/播放态给悬浮窗 */
    push(state: DesktopLyricState): void
    /** 悬浮窗订阅状态（歌词窗口用），返回取消订阅 */
    onState(cb: (state: DesktopLyricState) => void): Unsubscribe
    /** 悬浮窗设置锁定（点击穿透）（歌词窗口用） */
    setLock(locked: boolean): void
  }

  /** 下载队列 */
  download: {
    add(input: AddDownloadInput): Promise<void>
    list(): Promise<DownloadTask[]>
    pause(taskKey: string): Promise<void>
    resume(taskKey: string): Promise<void>
    retry(taskKey: string): Promise<void>
    remove(taskKey: string, deleteFile?: boolean): Promise<void>
    clearCompleted(): Promise<void>
    /** 订阅下载队列变更（主进程广播），返回取消订阅 */
    onChange(cb: () => void): Unsubscribe
  }

  /** 系统对话框 / Shell（下载路径选择、打开目录等） */
  shell: {
    /** 弹目录选择框，返回所选目录路径；取消返回 null */
    selectDirectory(defaultPath?: string): Promise<string | null>
    /** 在系统文件管理器中打开目录/文件 */
    openPath(path: string): Promise<string>
  }

  /** 平台登录 / 账号 */
  account: {
    /** 各平台登录态（含昵称/头像） */
    list(): Promise<AccountStatus[]>
    logout(provider: AccountProvider): Promise<void>
    /** 酷狗手动填凭据（桌面无 native 签名库，仅支持手填） */
    kgSave(creds: KgManualCreds): Promise<void>
    /** wy 扫码：申请二维码 */
    wyQrCreate(): Promise<WyQRCode | null>
    /** wy 扫码：轮询状态（success 时凭据已保存） */
    wyQrPoll(unikey: string): Promise<WyQRPoll>
    /** qq 扫码：申请二维码并起 WS 监听（状态经 onQQEvent 推送） */
    qqQrStart(): Promise<QQQRCodeInfo | null>
    /** qq 扫码：停止监听（关窗时调用） */
    qqQrStop(): Promise<void>
    /** 订阅 qq 扫码事件 */
    onQQEvent(cb: (e: QQQRStatusEvent) => void): Unsubscribe
    /** 订阅登录态变更（主进程广播） */
    onChange(cb: () => void): Unsubscribe
  }

  /** LX Music 同步 */
  sync: {
    /** 当前状态快照 */
    status(): Promise<SyncStatusSnapshot>
    /** 按 settings.sync 连接 */
    connect(): Promise<void>
    disconnect(): Promise<void>
    /** 清会话（下次连接重新 CDK 激活） */
    reset(): Promise<void>
    /** 订阅状态变更 */
    onStatus(cb: (s: SyncStatusSnapshot) => void): Unsubscribe
  }

  /** 备份 / 导入 */
  backup: {
    /** 完整备份到文件（settings + 收藏 + 歌单 + 试听） */
    exportFull(filePath: string): Promise<void>
    /** 仅导出歌单（可选含收藏/试听） */
    exportPlaylists(
      filePath: string,
      opts: { includeFavorites: boolean; includeTrial: boolean; playlistIds: number[] }
    ): Promise<void>
    /** 解析备份文件摘要 */
    parse(filePath: string): Promise<BackupSummary>
    /** 恢复备份 */
    restore(filePath: string, options: BackupRestoreOptions): Promise<BackupRestoreResult>
    /** 解析 LX 歌单文件（.lxmc / json）摘要，非法返回 null */
    lxParse(filePath: string): Promise<LxImportSummary | null>
    /** 导入 LX 歌单文件，非法返回 null */
    lxImport(filePath: string): Promise<LxImportResult | null>
    /** 弹保存对话框，返回路径（取消返回 null） */
    pickSave(defaultName: string): Promise<string | null>
    /** 弹打开对话框，返回路径（取消返回 null） */
    pickOpen(filters: { name: string; extensions: string[] }[]): Promise<string | null>
  }

  /** 自动更新 */
  updater: {
    check(): Promise<void>
    download(): Promise<void>
    install(): Promise<void>
    onEvent(cb: (e: UpdaterEvent) => void): Unsubscribe
  }
}
