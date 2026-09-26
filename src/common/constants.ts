/**
 * 跨端共享常量
 */
import type { MusicSource, QualityId } from './types/music'
import type { AppSettings } from './types/settings'

/** 六大在线音源顺序（云盘上游已删库，不再实现；local 为本地文件不在其列） */
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

/**
 * 音质档位顺序（从低到高）——全端唯一的档位排序真源。
 * 徽标取值、下载降级/升档、播放取流顺序、各处音质列表都由它派生，改这里即全局生效。
 *
 * 高低次序：臻品母带 > 全景声 > 高清臻音 > HiRes > FLAC > 320K > 128K。
 * 母带排在全景声之上——全景声是由立体声上混而来的特殊版本，母带才是保真度最高的一档。
 * 高清臻音（仅网易，键名 atmos_plus 沿用后端）排在沉浸环绕声之下，与网易自己的档位次序一致。
 *
 * 杜比全景声 / Audio Vivid 排在母带之上**不是**因为保真度更高（杜比是 256kbps 的 AC-4），
 * 而是它们换了格式：放在最顶上，从任何常规档往下降级都掉不进去，只有明确选了才会下到。
 */
export const QUALITY_IDS: readonly QualityId[] = [
  '128k',
  '320k',
  'flac',
  'hires',
  'atmos_plus',
  'atmos',
  'master',
  'dolby',
  'vivid'
] as const

/**
 * 音质通用名：跨平台的场合用（设置页的首选音质、多源混合的批量下载）。
 * 落到某一首歌上时用 qualityName(id, source)，各平台对特殊档位的叫法不一样。
 */
export const QUALITY_NAMES: Record<QualityId, string> = {
  '128k': '普通音质 128K',
  '320k': '高品音质 320K',
  flac: '无损音质 FLAC',
  hires: '无损音质 HiRes',
  master: '臻品母带',
  atmos: '臻品全景声',
  atmos_plus: '高清臻音',
  dolby: '杜比全景声',
  vivid: '臻音全景声'
}

/**
 * 各平台对特殊档位的叫法（取自 Android 版各源的 Quality 名），没列出的沿用 QUALITY_NAMES
 * （QQ / JOOX 的叫法就是通用名）。网易母带 Android 写的是旧名「鲸云母带」，现在叫超清母带。
 *
 * 网易这两档跟 Android 是反的：Android 把 sk 标成高清臻音、je 标成沉浸环绕声，
 * 后端实测 sk（level=sky，5.1 声道 FLAC）才是沉浸环绕声，je（jyeffect）是高清臻音。
 */
const SOURCE_QUALITY_NAMES: Partial<Record<MusicSource, Partial<Record<QualityId, string>>>> = {
  wy: { master: '超清母带', atmos: '沉浸环绕声' },
  kw: { master: '至臻母带', atmos: '至臻全景声' },
  kg: { master: '蝰蛇超清' }
}

/**
 * 某平台上该档位的显示名。展示一律走这里而不读 Quality.name：
 * 歌单里存着的旧歌还带着改名前的叫法，读存量会新旧混杂。
 */
export function qualityName(id: string, source?: MusicSource): string {
  const q = id as QualityId
  return (source && SOURCE_QUALITY_NAMES[source]?.[q]) || QUALITY_NAMES[q] || id
}

/**
 * 只能下载、Chromium 解不了的档位：杜比全景声（网易是 AC-4，QQ 是 E-AC-3）、Audio Vivid（AV3A），
 * Electron 44 实测 canPlayType 均为空。播放取流、播放页音质菜单、首选播放音质都跳过它们，
 * 下载照常可选（存 .mp4）。例外是主进程能软解的平台，见 SOFT_DECODERS——目前杜比两家都能播，
 * Audio Vivid 还没有解码器。
 */
export const DOWNLOAD_ONLY_QUALITY_IDS: readonly QualityId[] = ['dolby', 'vivid'] as const

/** 主进程软解器（src/main/audio/protocol.ts 按它把码流解成 <audio> 认得的格式） */
export type SoftDecoder = 'dolby'

/**
 * 只能下载的档位里，能在主进程软解后播放的平台（src/main/audio/dolbyStream.ts，
 * LibreMPEG 的解码器编成 wasm）。两家的杜比全景声都是 MP4 封装，但编码不同：
 * - 网易：AC-4 IMS（immersive stereo），Dolby 在编码端做好的两声道耳机渲染，解出来就是空间效果；
 * - QQ（QQ 音乐云取的是同一份文件）：E-AC-3 JOC，开源解码器都不解 JOC，只能解出 5.1 床声道再下混，
 *   听感接近普通立体声。
 */
const SOFT_DECODERS: Partial<Record<QualityId, Partial<Record<MusicSource, SoftDecoder>>>> = {
  dolby: { wy: 'dolby', qq: 'dolby', qqc: 'dolby' }
}

/** 这首歌的这一档要不要软解、用哪个软解器；不需要返回 undefined */
export function softDecoder(qualityId: string, source?: MusicSource): SoftDecoder | undefined {
  return source ? SOFT_DECODERS[qualityId as QualityId]?.[source] : undefined
}

/**
 * 「AI 音质」候选档位：全景声、高清臻音都由立体声算法处理而来；母带虽非 AI 生成，但同属特殊版本，
 * 一并列入让用户自行勾选（settings.quality.aiQualities 的可选项，默认屏蔽全景声与高清臻音）。
 */
export const AI_QUALITY_CANDIDATES: readonly QualityId[] = [
  'atmos',
  'atmos_plus',
  'master'
] as const

/**
 * 只在个别平台有效的档位。atmos_plus 以前还装过 QQ 的「臻品全景声 2.0」和酷我的 20501，
 * 那两档已下线，但存量歌单里的 QQ / 酷我歌还带着这个键：不按平台挡掉，
 * 就会被当成网易的高清臻音列出来、拿去取流。
 */
const SOURCE_ONLY_QUALITIES: Partial<Record<QualityId, readonly MusicSource[]>> = {
  atmos_plus: ['wy']
}

function foreignQualityIds(source?: MusicSource): QualityId[] {
  if (!source) return []
  const entries = Object.entries(SOURCE_ONLY_QUALITIES) as [QualityId, readonly MusicSource[]][]
  return entries.filter(([, only]) => !only.includes(source)).map(([id]) => id)
}

/**
 * 当前设置下需要跳过的音质档位（下载解析、下载音质选择列表用）。
 * 给了 `source` 时一并跳过不属于该平台的档位（见 SOURCE_ONLY_QUALITIES）。
 */
export function blockedQualityIds(settings: AppSettings, source?: MusicSource): readonly string[] {
  const q = settings.quality
  const ai = q?.blockAi ? (q.aiQualities ?? []) : []
  return [...ai, ...foreignQualityIds(source)]
}

/**
 * 播放侧要跳过的档位：blockedQualityIds 加上该平台解不了的只能下载档（取流、音质菜单、徽标共用）。
 * 不给 `source`（首选播放音质这种跨平台的场合）时一律跳过：只有个别平台能播，不该当全局首选。
 */
export function playbackBlockedQualityIds(
  settings: AppSettings,
  source?: MusicSource
): readonly string[] {
  const undecodable = DOWNLOAD_ONLY_QUALITY_IDS.filter((id) => !softDecoder(id, source))
  return [...blockedQualityIds(settings, source), ...undecodable]
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
  atmos_plus: { label: '臻音', tier: 'primary' },
  dolby: { label: '杜比', tier: 'primary' },
  vivid: { label: 'Vivid', tier: 'primary' }
}

/**
 * 取该曲可用的最高音质徽标：HiRes / SQ / HQ / 标准（母带、全景声用各自短标签）。
 * `blocked` 传 playbackBlockedQualityIds：徽标表示「点开能听到的最高档」，被屏蔽的 AI 音质听不到，
 * 所以不显示。杜比 / Audio Vivid 则一律不当徽标，哪怕杜比能软解播放：它们排在最顶上只是为了
 * 降级时掉不进去，按档位序取最高会把母带、HiRes 都盖掉，而有损的杜比（256～448kbps）并不比它们保真。
 * 无任何可用音质返回 null。
 */
export function qualityBadge(
  qualities: Record<string, unknown>,
  blocked?: readonly string[]
): QualityBadgeInfo | null {
  const ladder = [...QUALITY_IDS].reverse() // 高 → 低
  for (const q of ladder) {
    if (!qualities[q]) continue
    if (blocked?.includes(q) || DOWNLOAD_ONLY_QUALITY_IDS.includes(q)) continue
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

// ============ 发现（排行榜 / 热门歌单） ============

/** 支持排行榜与热门歌单的平台（对齐 LX：kw/kg/tx/wy；咪咕不做） */
export const DISCOVER_SOURCES: readonly MusicSource[] = ['wy', 'qq', 'kg', 'kw'] as const

export interface PlaylistSortOption {
  id: string
  name: string
}

/** 热门歌单排序项（各平台 id 直接对应其接口参数，取自 LX 各 songList.sortList） */
export const PLAYLIST_SORTS: Partial<Record<MusicSource, PlaylistSortOption[]>> = {
  // 网易云 playlist/list 的 order=new 实测返回空列表（LX 也只保留了最热）
  wy: [{ id: 'hot', name: '最热' }],
  qq: [
    { id: '5', name: '最热' },
    { id: '2', name: '最新' }
  ],
  kg: [
    { id: '5', name: '推荐' },
    { id: '6', name: '最热' },
    { id: '7', name: '最新' },
    { id: '3', name: '热藏' },
    { id: '8', name: '飙升' }
  ],
  kw: [
    { id: 'hot', name: '最热' },
    { id: 'new', name: '最新' }
  ]
}

/** 选了分类后排序仍然生效的平台（QQ/酷我的分类接口没有排序参数） */
export const PLAYLIST_CATEGORY_SORTABLE: Partial<Record<MusicSource, boolean>> = {
  wy: true,
  qq: false,
  kg: true,
  kw: false
}
