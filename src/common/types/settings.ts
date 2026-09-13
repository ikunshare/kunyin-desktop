/**
 * 应用设置（对应 Android 端 common/AppSettingsManager.kt 各分类）
 *
 * 采用嵌套对象结构（比 lx-music-desktop 的扁平点分 key 更适合 Pinia/TS）。
 * 敏感凭据不在此，走主进程 safeStorage 单独加密存储。
 */
import type { LogLevel } from './log'
import type { QualityId } from './music'

export type PlayMode = 'order' | 'listLoop' | 'singleLoop' | 'random'

/** 用户自定义主题（简化自 lx-music-desktop 的 ThemeEditModal 产物） */
export interface CustomThemeConfig {
  id: string
  name: string
  /** 深色底模式 */
  isDark: boolean
  /** 主色 rgb(...) */
  primary: string
  /** 字色 rgb(...) */
  font: string
  /** 深色字体梯度（用于浅色底上的低对比辅助文字） */
  isDarkFont?: boolean
  /** 背景图绝对路径；空串表示无背景图 */
  bgImage: string
  /** 应用/侧栏背景色 */
  appBackground?: string
  /** 侧栏按钮颜色 */
  sidebarButton?: string
  /** 内容区域背景色 */
  contentBackground?: string
  /** 音质标签主色 */
  badgePrimary?: string
  /** 音质标签次要色 */
  badgeSecondary?: string
  /** 音质标签第三色 */
  badgeTertiary?: string
  /** 窗口控制按钮颜色 */
  buttonClose?: string
  buttonMin?: string
  buttonHide?: string
}

export interface AppSettings {
  /** 设置结构版本号，用于迁移 */
  version: number

  appearance: {
    /** 主题 id；'auto' 表示跟随系统深浅色 */
    themeId: string
    followSystem: boolean
    /** followSystem / auto 模式下的浅色主题 */
    lightThemeId: string
    /** followSystem / auto 模式下的深色主题 */
    darkThemeId: string
    /** 用户自定义主题列表 */
    customThemes: CustomThemeConfig[]
    /** UI 语言 */
    lang: string
    /** 软件界面字体（字体族名，空=跟随系统默认字体栈） */
    appFont: string
    /** 窗口尺寸档位（WINDOW_SIZE_LIST 下标） */
    windowSizeId: number
    /** 界面字体大小 px（14~19，经 #app zoom 实现整体缩放） */
    fontSize: number
  }

  /** 桌面端窗口与动效行为（对应 lx-music-desktop 基础设置） */
  behavior: {
    /** 显示界面过渡与弹出层动画 */
    showAnimation: boolean
    /** 弹出层每次从若干入场动画中随机选择 */
    randomAnimation: boolean
    /** 启动后直接进入全屏 */
    startInFullscreen: boolean
    /** 点击关闭按钮时隐藏主窗口，由托盘继续驻留 */
    closeToTray: boolean
  }

  /** 列表显示（对应 lx-music-desktop 基础设置的列表项） */
  list: {
    /** 显示列表操作按钮（歌曲行 hover 的试听/添加/下载） */
    showOperationButtons: boolean
    /** 歌手页专辑用列表视图（false=网格；对应 Android albumListMode） */
    albumListMode: boolean
    /** 歌手页专辑按发行时间升序排列（false=新→旧，true=旧→新） */
    albumSortAsc: boolean
  }

  player: {
    /** 音量 0..1 */
    volume: number
    muted: boolean
    preloadNext: boolean
    autoSkipOnError: boolean
    autoSwitchSource: boolean
    outputDeviceId: string
    pauseOnDeviceChange: boolean
    playbackRate: number
    /** 每行一个歌名；以 @ 开头表示屏蔽歌手。 */
    dislikeRules: string
    /** 自定义全局快捷键；空字符串为禁用。 */
    shortcuts: Record<string, string>
    playMode: PlayMode
    /** 首选音质 */
    preferredQuality: QualityId
    /** 启动是否自动续播 */
    autoPlay: boolean
    /**
     * 音频缓存容量上限（字节），0 = 关闭。
     *
     * 完整听过的曲目按**解密后**的字节落盘（见 cache/audioCache），重听时连后端 getUrl
     * 都不必发；超出上限按 LRU 淘汰最久未播的。比上限还大的单曲不缓存。
     */
    audioCacheBytes: number
    /**
     * QQ 音乐听歌上报：登录 QQ 音乐后，播放 QQ 曲目时把听歌记录 / 最近播放 / 播放时长
     * 同步到 QQ 音乐账号（影响推荐与「最近播放」列表）。
     */
    qqListenReport: boolean
  }

  /** 音质过滤（播放取流与下载共用） */
  quality: {
    /** 屏蔽 AI 生成音质：播放与下载都跳过 aiQualities 里的档位，歌曲行徽标也不再显示 */
    blockAi: boolean
    /** 视为「AI 音质」的档位（可选项见 AI_QUALITY_CANDIDATES） */
    aiQualities: QualityId[]
  }

  lyrics: {
    showTranslation: boolean
    showRomanization: boolean
    fontSize: number
    /** 歌词字体（字体族名，空=跟随软件字体） */
    font: string
    /** 桌面歌词窗口开关 */
    desktopEnabled: boolean
    /** 锁定后窗口点击穿透 */
    desktopLocked: boolean
    /** 窗口置顶 */
    desktopAlwaysOnTop: boolean
    /** 定时刷新置顶状态，避免被部分全屏程序覆盖 */
    desktopAlwaysOnTopLoop: boolean
    /** 在系统任务栏显示桌面歌词窗口 */
    desktopShowTaskbar: boolean
    /** 主窗口全屏时隐藏桌面歌词 */
    desktopFullscreenHide: boolean
    /** 暂停播放时淡出桌面歌词 */
    desktopPauseHide: boolean
    /** 显示音频可视化装饰 */
    desktopAudioVisualization: boolean
    /** 桌面歌词窗口位置（null 表示未设置，用默认居中底部） */
    desktopX: number | null
    desktopY: number | null
    /** 桌面歌词窗口尺寸 */
    desktopWidth: number
    desktopHeight: number
    /** 限制窗口留在当前屏幕工作区内 */
    desktopLockScreen: boolean
    /** 使用更舒缓的延迟滚动 */
    desktopDelayScroll: boolean
    /** 当前歌词在窗口中的滚动锚点 */
    desktopScrollAlign: 'top' | 'center'
    /** 鼠标划过窗口时降低歌词透明度 */
    desktopHoverHide: boolean
    /** 歌词排版方向 */
    desktopDirection: 'horizontal' | 'vertical'
    /** 歌词水平对齐 */
    desktopAlign: 'left' | 'center' | 'right'
    /** 桌面歌词字体（空=跟随歌词字体） */
    desktopFont: string
    /** 桌面歌词字号 */
    desktopFontSize: number
    /** 歌词行间距 */
    desktopLineGap: number
    /** 桌面歌词已播放（高亮）文字颜色 */
    desktopColorActive: string
    /** 桌面歌词未播放文字颜色 */
    desktopColorNormal: string
    /** 歌词整体不透明度 6..100 */
    desktopOpacity: number
    /** 长歌词单行省略，不自动换行 */
    desktopEllipsis: boolean
    /** 放大当前播放行 */
    desktopZoomActive: boolean
    /** 加粗逐字歌词 */
    desktopBoldSyllable: boolean
    /** 加粗逐行歌词 */
    desktopBoldLine: boolean
    /** 加粗翻译和音译 */
    desktopBoldExtended: boolean
    /** 桌面歌词背景不透明度 0..1（0=全透明） */
    desktopBgOpacity: number
  }

  network: {
    proxy: {
      enable: boolean
      host: string
      port: number
    }
  }

  download: {
    /** 下载功能总开关（关闭后不再接收新任务） */
    enabled: boolean
    path: string
    /** 优先下载音质（单曲/批量下载弹窗的默认高亮与无指定时的回退首选） */
    preferredQuality: QualityId
    /** 整专下载单独保存一份专辑封面（v26.6.6 特性） */
    saveAlbumCover: boolean
    /** 文件名追加采样率/位深标记，如 [16Bit-44.1kHz]（仅无损，对应 Android downloadSampleRateTag） */
    appendQualityTag: boolean
    maxConcurrent: number
    /** 文件命名风格（对应 Android DownloadNamingStyle） */
    namingStyle: 'artist-title' | 'title-artist' | 'title-only'
    /** 整专下载的文件名前缀两位曲目号，如 `01.歌手 - 歌名`（对应 downloadTrackNumber） */
    trackNumberPrefix: boolean
    /** 同名文件是否覆盖（否则自动追加序号，对应 downloadOverwriteExisting） */
    overwriteExisting: boolean
    /** 存在同名文件时跳过下载（优先于 overwriteExisting；对应 download.skipExistFile） */
    skipExistFile: boolean
    /** 按歌单名分组保存（下载目录下再建歌单名子目录；对应 download.isSavePathGroupByListName） */
    groupByListName: boolean
    /** 把歌曲封面嵌入音频标签（对应 download.isEmbedPic） */
    embedCover: boolean
    /** 把歌词写入音频标签（对应 download.isEmbedLyric） */
    embedLyric: boolean
    /** 嵌入翻译歌词（需 embedLyric） */
    embedLyricT: boolean
    /** 嵌入罗马音歌词（需 embedLyric） */
    embedLyricR: boolean
    /** 嵌入逐字歌词（需 embedLyric） */
    embedLyricLx: boolean
    /** 额外保存 .lrc 歌词文件（对应 download.isDownloadLrc） */
    saveLrcFile: boolean
    /** 歌词文件附带翻译 */
    saveLrcT: boolean
    /** 歌词文件附带罗马音 */
    saveLrcR: boolean
    /** 歌词文件附带逐字歌词 */
    saveLrcLx: boolean
    /** 歌词文件编码（对应 download.lrcFormat） */
    lrcFormat: 'utf8' | 'gbk'
    /** 歌曲源不可用时换源下载（对应 download.isUseOtherSource） */
    useOtherSource: boolean
  }

  sync: {
    enable: boolean
    /** LX 同步服务端地址（http(s)://host:port/sync 或裸 host），对应 Android serverUrl */
    serverUrl: string
    /** 激活卡密（CDK），用于首次密钥协商 */
    cdk: string
    /** 本设备名（显示在服务端设备列表） */
    deviceName: string
    /** 同步模式：与 Go 端 TransMode 一致 */
    syncMode:
      | 'merge_local_remote'
      | 'merge_remote_local'
      | 'overwrite_local_remote'
      | 'overwrite_remote_local'
    /** 启动时自动连接 */
    autoConnect: boolean
  }

  /**
   * 开发者 / 排查问题相关。这些项在 Release 包里同样生效——线上出问题时
   * 让用户自己开高级别日志并把文件发回来，比让他装开发版复现现实得多。
   */
  developer: {
    /** 日志级别；silent 为完全关闭 */
    logLevel: LogLevel
    /** 把日志写入 userData/data/logs/（关闭后仅保留内存最近若干条） */
    logToFile: boolean
    /** 允许 Ctrl+F12 打开开发者工具（默认开启，Release 亦然） */
    devToolsShortcut: boolean
  }
}

export const DEFAULT_SETTINGS: AppSettings = {
  version: 2,
  appearance: {
    themeId: 'green',
    followSystem: true,
    lightThemeId: 'green',
    darkThemeId: 'black',
    customThemes: [],
    lang: 'zh-cn',
    appFont: '',
    windowSizeId: 3,
    fontSize: 16
  },
  behavior: {
    showAnimation: true,
    randomAnimation: true,
    startInFullscreen: false,
    closeToTray: false
  },
  list: {
    showOperationButtons: true,
    albumListMode: false,
    albumSortAsc: false
  },
  player: {
    volume: 1,
    muted: false,
    preloadNext: true,
    autoSkipOnError: true,
    autoSwitchSource: true,
    outputDeviceId: 'default',
    pauseOnDeviceChange: true,
    playbackRate: 1,
    dislikeRules: '',
    shortcuts: {},
    playMode: 'listLoop',
    preferredQuality: 'flac',
    autoPlay: false,
    audioCacheBytes: 4 * 1024 ** 3,
    qqListenReport: true
  },
  quality: {
    blockAi: true,
    aiQualities: ['atmos', 'atmos_plus']
  },
  lyrics: {
    showTranslation: true,
    showRomanization: false,
    fontSize: 22,
    font: '',
    desktopEnabled: false,
    desktopLocked: false,
    desktopAlwaysOnTop: true,
    desktopAlwaysOnTopLoop: false,
    desktopShowTaskbar: false,
    desktopFullscreenHide: true,
    desktopPauseHide: false,
    desktopAudioVisualization: false,
    desktopX: null,
    desktopY: null,
    desktopWidth: 640,
    desktopHeight: 180,
    desktopLockScreen: true,
    desktopDelayScroll: true,
    desktopScrollAlign: 'center',
    desktopHoverHide: false,
    desktopDirection: 'horizontal',
    desktopAlign: 'left',
    desktopFont: '',
    desktopFontSize: 28,
    desktopLineGap: 36,
    desktopColorActive: '#4daf7c',
    desktopColorNormal: '#ffffff',
    desktopOpacity: 100,
    desktopEllipsis: false,
    desktopZoomActive: false,
    desktopBoldSyllable: true,
    desktopBoldLine: true,
    desktopBoldExtended: false,
    desktopBgOpacity: 0.28
  },
  network: {
    proxy: {
      enable: false,
      host: '',
      port: 0
    }
  },
  download: {
    enabled: true,
    path: '',
    preferredQuality: 'flac',
    saveAlbumCover: true,
    appendQualityTag: true,
    maxConcurrent: 3,
    namingStyle: 'artist-title',
    trackNumberPrefix: true,
    overwriteExisting: false,
    skipExistFile: false,
    groupByListName: false,
    embedCover: true,
    embedLyric: true,
    embedLyricT: false,
    embedLyricR: false,
    embedLyricLx: false,
    saveLrcFile: false,
    saveLrcT: false,
    saveLrcR: false,
    saveLrcLx: true,
    lrcFormat: 'utf8',
    useOtherSource: false
  },
  sync: {
    enable: false,
    serverUrl: 'https://c.wwwweb.top/sync',
    cdk: '',
    deviceName: 'KunYin Desktop',
    syncMode: 'merge_local_remote',
    autoConnect: false
  },
  developer: {
    logLevel: 'info',
    logToFile: true,
    devToolsShortcut: true
  }
}

/**
 * 代理实际生效状态。setProxy 是 session 全局的，指向死端口的规则会让封面/取流/<audio>
 * 全部失败，故主进程应用前先探活；配了但不可达时 enabled=true 而 active=false。
 */
export interface ProxyStatus {
  /** 设置项里是否开启 */
  enabled: boolean
  /** 是否真正应用到了 session（探活通过） */
  active: boolean
  /** 未生效原因（enabled 为 true 而 active 为 false 时有值） */
  reason?: string
}

/** 各类缓存用量（设置页「缓存管理」展示） */
export interface CacheStats {
  /** 资源缓存字节数（封面等图片走 Chromium HTTP 磁盘缓存） */
  resourceBytes: number
  /** 播放地址缓存条目数 */
  urlCount: number
  /** 歌词缓存条目数 */
  lyricCount: number
  /** 音频缓存字节数 */
  audioBytes: number
  /** 音频缓存曲目数 */
  audioCount: number
}

/** 可单独清理的缓存类型 */
export type CacheKind = 'resource' | 'url' | 'lyric' | 'audio'

/** 卡密激活状态（authst 校验结果，主/渲染共享） */
export interface AuthState {
  /** 当前卡密（authst）；为空表示未激活 */
  authst: string
  /** 最近一次校验是否通过 */
  isValid: boolean
  /** 校验反馈信息 */
  message: string
}
