/**
 * 类型安全的 IPC 契约
 *
 * - `IpcChannels`：通道名常量（按域分组，避免撞名）。
 * - `WindowApi`：preload 通过 contextBridge 暴露、渲染层消费的 `window.api` 形状。
 *   主进程按 `IpcChannels` 注册 handler，preload 逐一转发到 `ipcRenderer.invoke`。
 *
 * 各域方法随分阶段实施逐步补齐；Phase 0 先立骨架（app/settings 真实实现，search/player 占位）。
 */
import type { LogEntry, LogFileInfo } from './log'
import type { KgLyricCandidate, Lyric, MusicItem, MusicSource } from './music'
import type {
  AlbumInfoResult,
  AlbumSearchResult,
  ArtistCapabilities,
  ArtistInfoResult,
  ArtistMvResult,
  ArtistSearchResult,
  AudioStreamResult,
  CommentResult,
  MediaInfoResult,
  MusicListResult,
  MvQuality,
  MvUrlResult,
  PlayListInfoResult,
  PlaylistSearchResult,
  UserInfo
} from './provider'
import type { ChartInfo, PlaylistCategory } from './provider'
import type { AppSettings, AuthState, CacheKind, CacheStats, ProxyStatus } from './settings'
import type { LocalPlaylist } from './library'
import type { AddDownloadInput, DownloadTask } from './download'

/** QQ 听歌上报事件（渲染层 → 主进程） */
export type QQReportEvent =
  | { kind: 'listening'; item: MusicItem; playTimeMs: number; playList: number[] }
  | { kind: 'recently'; item: MusicItem }
  | { kind: 'stream'; item: MusicItem; playTimeSec: number }

export const IpcChannels = {
  // 应用
  APP_VERSION: 'app:version',
  APP_PLATFORM: 'app:platform',
  /** 返回应用数据目录 userData/data/（settings.json 等所在处，见 main/core/paths.ts） */
  APP_USERDATA_PATH: 'app:userdata-path',

  // 窗口控制（无边框主窗口）
  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_CLOSE: 'window:close',
  WINDOW_FULLSCREEN: 'window:fullscreen',
  WINDOW_FULLSCREEN_CHANGED: 'window:fullscreen-changed',
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
  PLAYER_QQ_REPORT: 'player:qqReport',

  // 歌曲评论
  COMMENT_NEW: 'comment:new',
  COMMENT_HOT: 'comment:hot',
  COMMENT_SUPPORTED: 'comment:supported',

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
  LIBRARY_AUTO_REFRESH: 'library:autoRefresh',
  LIBRARY_REFRESH_REMOTE: 'library:refreshRemote',
  LIBRARY_IMPORT_REMOTE: 'library:importRemote',
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
  DISCOVER_CHARTS: 'discover:charts',
  DISCOVER_CHART_SONGS: 'discover:chartSongs',
  DISCOVER_CATEGORIES: 'discover:categories',
  DISCOVER_PLAYLISTS: 'discover:playlists',
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
  MEDIA_SHORTCUT_STATUS: 'media:shortcutStatus',
  /** 渲染 → 主：推送播放状态（用于更新任务栏缩略图工具栏的播放/暂停按钮） */
  MEDIA_SET_STATE: 'media:setState',
  MEDIA_SET_PROGRESS: 'media:setProgress',

  // 桌面歌词悬浮窗
  DESKTOP_LYRIC_TOGGLE: 'desktopLyric:toggle', // 渲染 → 主：开/关窗口
  DESKTOP_LYRIC_PUSH: 'desktopLyric:push', // 主窗口 → 主：推送歌词/进度/播放态
  DESKTOP_LYRIC_STATE: 'desktopLyric:state', // 主 → 歌词窗口：转发状态
  DESKTOP_LYRIC_SET_LOCK: 'desktopLyric:setLock', // 歌词窗口 → 主：锁定（点击穿透）
  DESKTOP_LYRIC_SEEK: 'desktopLyric:seek', // 歌词窗口 → 主：点击歌词行请求跳转（ms）
  DESKTOP_LYRIC_SEEK_REQUEST: 'desktopLyric:seekRequest', // 主 → 主窗口：执行跳转（ms）

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
  ACCOUNT_KG_QR_CREATE: 'account:kgQrCreate', // kg 扫码：申请二维码
  ACCOUNT_KG_QR_POLL: 'account:kgQrPoll', // kg 扫码：轮询状态
  ACCOUNT_KG_QR_STOP: 'account:kgQrStop', // kg 扫码：放弃当前二维码会话
  ACCOUNT_WY_QR_CREATE: 'account:wyQrCreate', // wy 扫码：申请二维码
  ACCOUNT_WY_QR_POLL: 'account:wyQrPoll', // wy 扫码：轮询状态
  ACCOUNT_QQ_QR_START: 'account:qqQrStart', // qq 扫码：申请二维码并起 WS 监听
  ACCOUNT_QQ_QR_STOP: 'account:qqQrStop', // qq 扫码：停止监听
  ACCOUNT_QQ_QR_EVENT: 'account:qqQrEvent', // 主 → 渲染：qq 扫码状态事件
  ACCOUNT_QQ_WEB_OPEN: 'account:qqWebOpen', // qq 网页登录：打开 y.qq.com 登录窗
  ACCOUNT_QQ_WEB_FINISH: 'account:qqWebFinish', // qq 网页登录：从登录窗 cookie 提取凭据
  ACCOUNT_QQ_WEB_CLOSE: 'account:qqWebClose', // qq 网页登录：关闭登录窗
  ACCOUNT_QQ_WEB_EVENT: 'account:qqWebEvent', // 主 → 渲染：qq 网页登录结果
  ACCOUNT_CHANGED: 'account:changed', // 主 → 渲染 事件（登录态变更）

  // 平台「我的歌单」（缓存优先、后台刷新）
  PLATFORM_SECTIONS: 'platform:sections',
  PLATFORM_REFRESH: 'platform:refresh',
  PLATFORM_SONGS: 'platform:songs',
  PLATFORM_SONGS_PROGRESS: 'platform:songsProgress', // 主 → 渲染 事件（整单后台补齐的逐页推送）
  PLATFORM_CHANGED: 'platform:changed', // 主 → 渲染 事件

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

  // 日志 / 开发者工具（Release 包同样可用，用于线上排查）
  LOG_WRITE: 'log:write', // 渲染 → 主：转发一条渲染层日志（send，不等回执）
  LOG_INFO: 'log:info', // 日志文件概况
  LOG_RECENT: 'log:recent', // 内存里最近若干条
  LOG_DUMP: 'log:dump', // 导出最近日志为独立文件，返回路径
  LOG_OPEN_DIR: 'log:openDir', // 在文件管理器中打开日志目录
  DEVTOOLS_TOGGLE: 'devtools:toggle', // 开/关当前窗口的开发者工具

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
export type MediaCommand =
  | 'playpause'
  | 'next'
  | 'prev'
  | 'volumeUp'
  | 'volumeDown'
  | 'mute'
  | 'seekForward'
  | 'seekBackward'
  | 'favorite'
  | 'desktopLyric'

/** 歌单内排序字段（LX 排序歌曲） */
export type PlaylistSortField = 'title' | 'artist' | 'album' | 'duration' | 'source'
/** 歌单内排序方向；random 为随机打乱 */
export type PlaylistSortOrder = 'asc' | 'desc' | 'random'

/**
 * 桌面歌词状态（主窗口 → 歌词窗口，经主进程转发）。
 *
 * ⚠ 增量帧：歌词全文按曲目才变，进度/频谱却要 80ms 推一次——全量重发等于每秒把整份
 * QRC 结构化克隆二十几遍（主窗口→主进程→歌词窗各一次）。因此内容字段只在曲目/歌词
 * 变化的那一帧携带，其余帧省略。主进程按帧合并出完整快照，新歌词窗打开时回灌该快照；
 * 歌词窗则以「本帧是否携带 lyric」判断要不要重建歌词。
 */
export interface DesktopLyricState {
  /** 当前播放时间（毫秒） */
  currentTime: number
  playing: boolean
  /** Web Audio AnalyserNode 采样的实时频谱，值域 0..1 */
  spectrum: number[]
  /**
   * 生效中的倍速（`<audio>.playbackRate`）。歌词窗的引擎自走一条墙钟时钟，
   * 不同步倍速就会按 1× 推进、越放越落后。缺省视作 1。
   */
  playbackRate?: number
  /** 是否有歌词（无则显示占位/隐藏）。仅内容帧携带。 */
  hasLyric?: boolean
  /** 主歌词（增强 LRC 或行级 LRC），歌词窗自行用 kit 解析。仅内容帧携带。 */
  lyric?: string
  /** 仅内容帧携带 */
  translate?: string
  /** 仅内容帧携带 */
  roman?: string
  /** 当前曲目标题（无歌词时展示）。仅内容帧携带。 */
  title?: string
  /** 供歌词净化识别首行「歌名 - 歌手」元信息。仅内容帧携带。 */
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

/** kg 扫码二维码信息（内容为一串 URL，图片由渲染层生成） */
export interface KgQRCode {
  url: string
  ticket: string
}

/** kg 扫码轮询结果 */
export interface KgQRPoll {
  status: 'waiting' | 'success' | 'expired' | 'error'
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

/** qq 网页登录结果（主 → 渲染）：success 时凭据已保存；closed = 登录窗关了但没拿到登录态 */
export interface QQWebLoginEvent {
  status: 'success' | 'closed'
  message?: string
}

/** 某个登录平台的「我的歌单」区块（对应 Android PlatformSection） */
export interface PlatformSection {
  source: AccountProvider
  displayName: string
  /** 缓存的用户信息；还没刷新到时为 null */
  userInfo: UserInfo | null
  playlists: PlayListInfoResult[]
  /** 正在后台刷新 */
  loading: boolean
}

/**
 * 平台歌单曲目快照（`platform.songs` 的返回值）。
 * 首页到手就返回，余页由主进程后台补齐并经 PLATFORM_SONGS_PROGRESS 逐页推送。
 */
export interface PlatformSongsSnapshot {
  source: AccountProvider
  id: string
  /** 本次拉取批次号：切歌单 / 重新拉取会换号，渲染层据此丢弃过期推送；来自完整缓存时为 0 */
  runId: number
  /** 目前已拿到的曲目（累计） */
  songs: MusicItem[]
  /** 远端总曲数（接口没给时缺省） */
  total?: number
  /** 已拉完（或来自完整缓存） */
  complete: boolean
  /** 拉取失败的提示；songs 为失败前已拿到的部分 */
  error?: string
}

/** 平台歌单后台补齐的逐页推送（主 → 渲染） */
export interface PlatformSongsProgress {
  source: AccountProvider
  id: string
  runId: number
  /** 这一页新到的曲目（已按 key 去重，直接追加到列表末尾） */
  added: MusicItem[]
  /** 累计已加载曲数 */
  loaded: number
  total?: number
  complete: boolean
  error?: string
}

/**
 * `window.api` 的类型。渲染层通过它调用主进程能力，不直接触网。
 */
export interface WindowApi {
  app: {
    getVersion(): Promise<string>
    getPlatform(): Promise<NodeJS.Platform>
  }

  /** 主窗口控制（无边框窗口的最小化/关闭/全屏） */
  window: {
    minimize(): Promise<void>
    close(): Promise<void>
    /** 不传值时只查询当前状态；传值时切换全屏并返回新状态 */
    fullscreen(enabled?: boolean): Promise<boolean>
    /** 原生全屏状态变化（含 Esc 退出） */
    onFullscreenChange(cb: (fullscreen: boolean) => void): Unsubscribe
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

  /** 日志与开发者工具（Release 包同样可用） */
  log: {
    /** 把一条渲染层日志送到主进程统一落盘（fire-and-forget） */
    write(entry: LogEntry): void
    /** 日志目录与占用概况 */
    info(): Promise<LogFileInfo>
    /** 内存里最近若干条（新→旧） */
    recent(limit?: number): Promise<LogEntry[]>
    /** 导出最近日志为独立文件，返回路径；失败为 null */
    dump(): Promise<string | null>
    /** 在系统文件管理器中打开日志目录 */
    openDir(): Promise<void>
    /** 开/关当前主窗口的开发者工具（等效 Ctrl+F12） */
    toggleDevTools(): Promise<void>
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
    /**
     * QQ 音乐听歌上报（仅 QQ 曲目、已登录、设置开启时有效；失败静默）。
     * - listening：听歌记录，playTimeMs 为当前播放位置，playList 为队列里 QQ 曲目 id
     * - recently：同步到 QQ 音乐客户端「最近播放」
     * - stream：播放流水，playTimeSec 为本段实际播放秒数
     */
    qqReport(event: QQReportEvent): Promise<boolean>
  }

  /** 歌曲评论（播放页评论面板） */
  comment: {
    /** 该音源是否支持评论（不支持时面板显示占位） */
    supported(source: MusicSource): Promise<boolean>
    /** 最新评论 */
    latest(item: MusicItem, page?: number, limit?: number): Promise<CommentResult>
    /** 热门评论 */
    hot(item: MusicItem, page?: number, limit?: number): Promise<CommentResult>
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
    setAutoRefresh(playlistId: number, enabled: boolean): Promise<void>
    refreshRemote(playlistId: number): Promise<number>
    importRemote(
      source: MusicSource,
      id: string,
      name: string,
      chart?: boolean,
      period?: string
    ): Promise<number>
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
    charts(source: MusicSource): Promise<ChartInfo[]>
    chartSongs(
      source: MusicSource,
      id: string,
      page: number,
      size: number,
      period?: string
    ): Promise<MusicListResult>
    categories(source: MusicSource): Promise<PlaylistCategory[]>
    playlists(
      source: MusicSource,
      category: string,
      order: string,
      page: number,
      size: number
    ): Promise<PlaylistSearchResult>
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
    shortcutStatus(): Promise<Record<string, string>>
    /** 订阅播放命令（playpause/next/prev），返回取消订阅 */
    onCommand(cb: (cmd: MediaCommand) => void): Unsubscribe
    /** 推送播放状态给主进程（更新任务栏缩略图工具栏的播放/暂停按钮、休眠拦截） */
    setState(playing: boolean): void
    /** 推送播放进度 0..1（任务栏/dock 进度条；1 秒一次，够用且不吵） */
    setProgress(percent: number): void
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
    /** 悬浮窗点击歌词行请求跳转到指定毫秒（歌词窗口用） */
    seek(ms: number): void
    /** 主窗口订阅悬浮窗发来的跳转请求，返回取消订阅（主窗口用） */
    onSeekRequest(cb: (ms: number) => void): Unsubscribe
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
    /** 酷狗手动填凭据（扫码之外的兜底入口） */
    kgSave(creds: KgManualCreds): Promise<void>
    /** kg 扫码：申请二维码 */
    kgQrCreate(): Promise<KgQRCode | null>
    /** kg 扫码：轮询状态（success 时凭据已保存） */
    kgQrPoll(ticket: string): Promise<KgQRPoll>
    /** kg 扫码：放弃当前二维码会话（关窗时调用） */
    kgQrStop(): Promise<void>
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
    /** qq 网页登录：打开 y.qq.com 登录窗（结果经 onQQWebEvent 推送；用户关窗时自动尝试提取） */
    qqWebOpen(): Promise<void>
    /** qq 网页登录：立即从登录窗提取凭据；成功返回 true（已保存并关窗），失败保留窗口 */
    qqWebFinish(): Promise<boolean>
    /** qq 网页登录：放弃并关窗（关闭登录弹窗时调用） */
    qqWebClose(): Promise<void>
    /** 订阅 qq 网页登录结果 */
    onQQWebEvent(cb: (e: QQWebLoginEvent) => void): Unsubscribe
    /** 订阅登录态变更（主进程广播） */
    onChange(cb: () => void): Unsubscribe
  }

  /** 各平台「我的歌单」（缓存优先；对应 Android PlatformPlaylistStore + PlaylistsViewModel） */
  platform: {
    /** 登录平台的用户信息 + 歌单列表（只读缓存，立即返回） */
    sections(): Promise<PlatformSection[]>
    /** 后台刷新（不传 source 刷新全部；60s 内重复调用会被跳过，force 强制） */
    refresh(source?: AccountProvider, force?: boolean): Promise<void>
    /**
     * 某歌单曲目：有完整缓存直接给；否则首页到手就返回（complete=false），
     * 余页主进程后台补齐、经 onSongsProgress 逐页推送，拉齐后落缓存。force 忽略缓存重拉。
     */
    songs(source: AccountProvider, id: string, force?: boolean): Promise<PlatformSongsSnapshot>
    /** 订阅整单后台补齐的逐页推送 */
    onSongsProgress(cb: (p: PlatformSongsProgress) => void): Unsubscribe
    /** 订阅缓存 / 加载态变化（主进程广播） */
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
