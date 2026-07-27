/**
 * 应用设置（对应 Android 端 common/AppSettingsManager.kt 各分类）
 *
 * 采用嵌套对象结构（比 lx-music-desktop 的扁平点分 key 更适合 Pinia/TS）。
 * 敏感凭据不在此，走主进程 safeStorage 单独加密存储。
 */
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
  /** 背景图绝对路径；空串表示无背景图 */
  bgImage: string
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

  /** 列表显示（对应 lx-music-desktop 基础设置的列表项） */
  list: {
    /** 显示列表操作按钮（歌曲行 hover 的试听/添加/下载） */
    showOperationButtons: boolean
  }

  player: {
    /** 音量 0..1 */
    volume: number
    playMode: PlayMode
    /** 首选音质 */
    preferredQuality: QualityId
    /** 启动是否自动续播 */
    autoPlay: boolean
  }

  lyrics: {
    showTranslation: boolean
    showRomanization: boolean
    fontSize: number
    /** 歌词字体（字体族名，空=跟随软件字体） */
    font: string
    /** 桌面歌词窗口开关 */
    desktopEnabled: boolean
    /** 桌面歌词窗口位置（-1 表示未设置，用默认居中底部） */
    desktopX: number
    desktopY: number
    /** 桌面歌词字号 */
    desktopFontSize: number
    /** 桌面歌词已播放（高亮）文字颜色 */
    desktopColorActive: string
    /** 桌面歌词未播放文字颜色 */
    desktopColorNormal: string
    /** 桌面歌词背景不透明度 0..1（0=全透明，仅描边阴影） */
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
    /** 文件名前缀两位轨号（整专用，对应 downloadTrackNumber） */
    trackNumberPrefix: boolean
    /** 同名文件是否覆盖（否则自动追加序号，对应 downloadOverwriteExisting） */
    overwriteExisting: boolean
    /** 把歌词写入音频标签（对应 downloadWriteLyricMeta） */
    writeLyricMeta: boolean
    /** 额外保存 .lrc 歌词文件（对应 downloadLrcFile） */
    saveLrcFile: boolean
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
}

export const DEFAULT_SETTINGS: AppSettings = {
  version: 1,
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
  list: {
    showOperationButtons: true
  },
  player: {
    volume: 1,
    playMode: 'listLoop',
    preferredQuality: 'flac',
    autoPlay: false
  },
  lyrics: {
    showTranslation: true,
    showRomanization: false,
    fontSize: 22,
    font: '',
    desktopEnabled: false,
    desktopX: -1,
    desktopY: -1,
    desktopFontSize: 28,
    desktopColorActive: '#4daf7c',
    desktopColorNormal: '#ffffff',
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
    path: '',
    preferredQuality: 'flac',
    saveAlbumCover: true,
    appendQualityTag: true,
    maxConcurrent: 3,
    namingStyle: 'artist-title',
    trackNumberPrefix: false,
    overwriteExisting: false,
    writeLyricMeta: true,
    saveLrcFile: false
  },
  sync: {
    enable: false,
    serverUrl: 'https://c.wwwweb.top/sync',
    cdk: '',
    deviceName: 'KunYin Desktop',
    syncMode: 'merge_local_remote',
    autoConnect: false
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
}

/** 可单独清理的缓存类型 */
export type CacheKind = 'resource' | 'url' | 'lyric'

/** 卡密激活状态（authst 校验结果，主/渲染共享） */
export interface AuthState {
  /** 当前卡密（authst）；为空表示未激活 */
  authst: string
  /** 最近一次校验是否通过 */
  isValid: boolean
  /** 校验反馈信息 */
  message: string
}
