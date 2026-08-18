/**
 * 跨端共享常量
 */
import type { MusicSource, QualityId } from './types/music'
import type { AppSettings } from './types/settings'

/** 五大在线音源顺序（云盘上游已删库，不再实现；local 为本地文件不在其列） */
export const PLATFORMS: readonly MusicSource[] = ['wy', 'qq', 'qqc', 'kg', 'kw', 'joox'] as const

/** 音源显示名（取自 Android 各 Provider.displayName） */
export const PLATFORM_NAMES: Record<MusicSource, string> = {
  wy: '网易云音乐',
  qq: 'QQ音乐',
  qqc: 'QQ音乐云',
  kg: '酷狗音乐',
  kw: '酷我音乐',
  joox: 'JOOX',
  local: '本地'
}

/** 音源短标签（取自 Android 各 Provider.shortTag；注意 joox 为 jx） */
export const PLATFORM_SHORT_TAGS: Record<MusicSource, string> = {
  wy: 'wy',
  qq: 'qq',
  qqc: 'qqc',
  kg: 'kg',
  kw: 'kw',
  joox: 'jx',
  local: 'local'
}

/**
 * 内部音源标识 → 自建后端 getUrl 的 platform 名映射。
 * 见 tool/MusicUrlHelper：qq→qq, kg→kugou, kw→kuwo, wy→wyy, joox→joox。
 * local 直接播放本地文件，不走后端。
 */
export const BACKEND_PLATFORM: Record<MusicSource, string> = {
  wy: 'wyy',
  qq: 'qq',
  qqc: 'qq',
  kg: 'kugou',
  kw: 'kuwo',
  joox: 'joox',
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

/** 音质显示名（全端统一口径；flac24bit 在解码层归一化到 hires） */
export const QUALITY_NAMES: Record<QualityId, string> = {
  '128k': '普通音质 128K',
  '320k': '高品音质 320K',
  flac: '无损音质 FLAC',
  hires: '无损音质 HiRes',
  master: '臻品母带',
  atmos: '臻品全景声',
  atmos_plus: '臻品全景声 2.0'
}

/**
 * 「AI 音质」候选档位：全景声系列由立体声算法上混而来；母带虽非 AI 生成，但同属特殊版本，
 * 一并列入让用户自行勾选（settings.quality.aiQualities 的可选项，默认只屏蔽两档全景声）。
 */
export const AI_QUALITY_CANDIDATES: readonly QualityId[] = [
  'master',
  'atmos',
  'atmos_plus'
] as const

/** 当前设置下需要跳过的音质档位（播放取流、下载解析、音质选择列表共用）。 */
export function blockedQualityIds(settings: AppSettings): readonly string[] {
  const q = settings.quality
  return q?.blockAi ? (q.aiQualities ?? []) : []
}

/** 列表行音质徽标（对应 lx-music 的 tag__high_quality / tag__lossless / tag__lossless_24bit） */
export interface QualityBadgeInfo {
  label: string
  /** primary=无损及以上（绿）；secondary=高品 320K（蓝）；tertiary=标准 128K（灰） */
  tier: 'primary' | 'secondary' | 'tertiary'
}

/** 各档位对应的行内徽标文案 */
const QUALITY_BADGES: Record<QualityId, QualityBadgeInfo> = {
  '128k': { label: '标准', tier: 'tertiary' },
  '320k': { label: 'HQ', tier: 'secondary' },
  flac: { label: 'SQ', tier: 'primary' },
  hires: { label: 'HiRes', tier: 'primary' },
  master: { label: '母带', tier: 'primary' },
  atmos: { label: '全景声', tier: 'primary' },
  atmos_plus: { label: '全景声 2.0', tier: 'primary' }
}

/**
 * 取该曲可用的最高音质徽标：HiRes / SQ / HQ / 标准（母带、全景声用各自短标签）。
 * `blocked` 为被屏蔽的档位（AI 音质），既然播放/下载都不会用它，徽标也不显示它。
 * 无任何可用音质返回 null。
 */
export function qualityBadge(
  qualities: Record<string, unknown>,
  blocked?: readonly string[]
): QualityBadgeInfo | null {
  const ladder = [...QUALITY_IDS].reverse() // 高 → 低
  for (const q of ladder) {
    if (!qualities[q]) continue
    if (blocked?.includes(q)) continue
    return QUALITY_BADGES[q]
  }
  return null
}

/**
 * 音质自动降级顺序：从目标档开始，按档位从高到低依次降级（绝不向上升档）。
 * `available` 为该曲真实可用的档位表（缺省视为全部可用）；`blocked` 为被屏蔽档位（AI 音质）；
 * 目标档不在标准档位表时退回 [target]。
 * 用于下载在首选档解析失败时逐级回退到更低档（播放侧的降级见 player store 的 qualityOrder）。
 */
export function qualityFallbackOrder(
  target: string,
  available?: Readonly<Record<string, unknown>>,
  blocked?: readonly string[]
): string[] {
  const isBlocked = (q: string): boolean => !!blocked?.includes(q)
  const ladder = [...QUALITY_IDS].reverse() // 高 → 低
  const start = ladder.indexOf(target as QualityId)
  if (start < 0) {
    if (isBlocked(target)) return []
    return available && !available[target] ? [] : [target]
  }
  const order: string[] = []
  for (let i = start; i < ladder.length; i++) {
    const q = ladder[i]
    if (isBlocked(q)) continue
    if (!available || available[q]) order.push(q)
  }
  return order
}

/**
 * 比目标档更高的可用档位（低 → 高）。仅在目标档及其以下全无可用档时兜底用，
 * 保证「选 FLAC 但该曲只有 HiRes」仍能下到东西，同时不会一步跳到最高档。
 */
export function qualityUpgradeOrder(
  target: string,
  available?: Readonly<Record<string, unknown>>,
  blocked?: readonly string[]
): string[] {
  const start = QUALITY_IDS.indexOf(target as QualityId) // QUALITY_IDS 为低 → 高
  if (start < 0) return []
  const order: string[] = []
  for (let i = start + 1; i < QUALITY_IDS.length; i++) {
    const q = QUALITY_IDS[i]
    if (blocked?.includes(q)) continue
    if (!available || available[q]) order.push(q)
  }
  return order
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
