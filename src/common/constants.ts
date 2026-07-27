/**
 * 跨端共享常量
 */
import type { MusicSource, QualityId } from './types/music'

/** 六大在线音源顺序（云盘上游已删库，不再实现；local 为本地文件不在其列） */
export const PLATFORMS: readonly MusicSource[] = ['wy', 'qq', 'kg', 'kw', 'joox', 'sp'] as const

/** 音源显示名（取自 Android 各 Provider.displayName） */
export const PLATFORM_NAMES: Record<MusicSource, string> = {
  wy: '网易云音乐',
  qq: 'QQ音乐',
  kg: '酷狗音乐',
  kw: '酷我音乐',
  joox: 'JOOX',
  sp: 'Spotify',
  local: '本地'
}

/** 音源短标签（取自 Android 各 Provider.shortTag；注意 joox 为 jx） */
export const PLATFORM_SHORT_TAGS: Record<MusicSource, string> = {
  wy: 'wy',
  qq: 'qq',
  kg: 'kg',
  kw: 'kw',
  joox: 'jx',
  sp: 'sp',
  local: 'local'
}

/**
 * 内部音源标识 → 自建后端 getUrl 的 platform 名映射。
 * 见 tool/MusicUrlHelper：qq→qq, kg→kugou, kw→kuwo, wy→wyy, joox→joox。
 * sp 不走 /app/getUrl（走 /music/url，由 SpProvider 自行解析），映射仅为类型完整；
 * local 同理（播放直接读文件）。
 */
export const BACKEND_PLATFORM: Record<MusicSource, string> = {
  wy: 'wyy',
  qq: 'qq',
  kg: 'kugou',
  kw: 'kuwo',
  joox: 'joox',
  sp: 'sp',
  local: ''
}

/** 音质档位顺序（从低到高） */
export const QUALITY_IDS: readonly QualityId[] = [
  '128k',
  '320k',
  'flac',
  'hires',
  'master',
  'atmos',
  'atmos_plus'
] as const

/** 音质显示名 */
export const QUALITY_NAMES: Record<QualityId, string> = {
  '128k': '标准',
  '320k': '高品质',
  flac: '无损',
  hires: 'Hi-Res',
  master: '母带',
  atmos: '全景声',
  atmos_plus: '全景声增强'
}

/** 固定列表 id（对应 Android LocalPlaylist 的 favorites/recent 及下载/临时列表） */
export const LIST_IDS = {
  DEFAULT: 'default',
  /** 收藏 / 我喜欢 */
  LOVE: 'love',
  /** 最近播放 */
  RECENT: 'recent',
  /** 下载 */
  DOWNLOAD: 'download',
  /** 临时播放列表（不持久化到用户歌单） */
  TEMP: 'temp'
} as const

export type FixedListId = (typeof LIST_IDS)[keyof typeof LIST_IDS]

/** 自建播放地址后端 */
export const GET_URL_ENDPOINT = 'https://c.wwwweb.top/app/getUrl'

/** 自建后端 /music/* 接口基址（Spotify 等经 X-Api-Key 卡密鉴权的源走这套） */
export const MUSIC_API_BASE = 'https://c.wwwweb.top/music'

/** 窗口尺寸档位（取自 lx-music-desktop common/config.ts 的 windowSizeList） */
export interface WindowSizeItem {
  id: number
  name: string
  width: number
  height: number
}
export const WINDOW_SIZE_LIST: readonly WindowSizeItem[] = [
  { id: 0, name: '更小', width: 828, height: 540 },
  { id: 1, name: '小', width: 920, height: 600 },
  { id: 2, name: '中', width: 1020, height: 660 },
  { id: 3, name: '大', width: 1114, height: 718 },
  { id: 4, name: '更大', width: 1202, height: 776 },
  { id: 5, name: '超大', width: 1385, height: 896 },
  { id: 6, name: '巨大', width: 1700, height: 1070 }
] as const

/** 界面字体大小档位（px；LX 为 html font-size，本应用经 #app zoom 实现整体缩放） */
export const FONT_SIZE_LIST: readonly { id: number; name: string }[] = [
  { id: 14, name: '更小' },
  { id: 15, name: '小' },
  { id: 16, name: '标准' },
  { id: 17, name: '大' },
  { id: 18, name: '更大' },
  { id: 19, name: '非常大' }
] as const
