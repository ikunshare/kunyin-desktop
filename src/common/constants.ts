/**
 * 跨端共享常量
 */
import type { MusicSource, QualityId } from './types/music'

/** 五大音源顺序（云盘上游已删库，不再实现） */
export const PLATFORMS: readonly MusicSource[] = ['wy', 'qq', 'kg', 'kw', 'joox'] as const

/** 音源显示名（取自 Android 各 Provider.displayName） */
export const PLATFORM_NAMES: Record<MusicSource, string> = {
  wy: '网易云音乐',
  qq: 'QQ音乐',
  kg: '酷狗音乐',
  kw: '酷我音乐',
  joox: 'JOOX'
}

/** 音源短标签（取自 Android 各 Provider.shortTag；注意 joox 为 jx） */
export const PLATFORM_SHORT_TAGS: Record<MusicSource, string> = {
  wy: 'wy',
  qq: 'qq',
  kg: 'kg',
  kw: 'kw',
  joox: 'jx'
}

/**
 * 内部音源标识 → 自建后端 getUrl 的 platform 名映射。
 * 见 tool/MusicUrlHelper：qq→qq, kg→kugou, kw→kuwo, wy→wyy, joox→joox。
 */
export const BACKEND_PLATFORM: Record<MusicSource, string> = {
  wy: 'wyy',
  qq: 'qq',
  kg: 'kugou',
  kw: 'kuwo',
  joox: 'joox'
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
