/**
 * 音源统一数据模型（对应 Android 端 model/MusicItem.kt、Quality.kt、Singer.kt、Lyric.kt）
 *
 * 主进程各音源 Provider 产出这些结构，经 IPC 传给渲染层。
 * `MusicItem` 为按 `type` 分发的可辨识联合（discriminated union）。
 */

/** 音源标识（反序列化分发用）。注意：与后端 getUrl 的 platform 名不同，映射见 crypto/请求层。
 * `local` 为本地文件（不走任何 Provider / 后端），仅出现在歌单里。 */
export type MusicSource = 'wy' | 'qq' | 'qqc' | 'kg' | 'kw' | 'joox' | 'local'

/** 跨平台统一的音质键 */
export type QualityId = '128k' | '320k' | 'flac' | 'hires' | 'master' | 'atmos' | 'atmos_plus'

/** 单个音质档位（对应 Quality.kt） */
export interface Quality {
  id: string
  name: string
  /** 文件大小（字节），未知为 0 */
  filesize: number
  bitrate?: number
  md5?: string
  /** QQ 用它塞 mediaMid / 特殊音质 vs 等 */
  mediaInfo?: string
  displaySize?: string
}

/** 歌手（对应 Singer.kt）。QQ 把 singerMid 放进 extra；网易把 picUrl 放进 headimg。 */
export interface Singer {
  name: string
  headimg?: string
  /** 数值歌手 id；0 表示接口未给（此时无法跳歌手页） */
  singerId: number
  extra?: string
}

/**
 * 取跳歌手页要用的 id：QQ 的歌手接口只认 singerMid（存在 extra），其余源用数值 id。
 * 返回 null 表示该歌手无法定位（菜单里就不该给入口）。
 */
export function getSingerRouteId(singer: Singer, source: MusicSource): string | null {
  if (source === 'qq') return singer.extra || null
  return singer.singerId > 0 ? String(singer.singerId) : null
}

/** 各平台歌曲的公共字段（对应 MusicItem 抽象基类） */
export interface BaseMusicItem {
  type: MusicSource
  id: number
  title: string
  artist: string
  album: string
  cover: string
  /** 时长（毫秒） */
  duration: number
  qualities: Record<string, Quality>
  tags?: string[]
  albumId?: string
  singers?: Singer[]
  mvid?: string
}

/** 网易云（无额外字段，仅音质键映射 l/h/sq/hr → 128k/320k/flac/hires） */
export interface NeteaseMusicItem extends BaseMusicItem {
  type: 'wy'
}

/** QQ 音乐 */
export interface QQMusicItem extends BaseMusicItem {
  type: 'qq'
  mid: string
  albumMid: string
  mediaMid: string
  vs?: string[]
  sizeNew?: number[]
}

/** 酷狗音乐（hash 为核心标识，uniqueKey 优先用 kg_$hash） */
export interface KugouMusicItem extends BaseMusicItem {
  type: 'kg'
  hash: string
  mixsongmid?: number
  allHash?: string[]
  audioId?: string
  lyricAccessKey?: string
  lyricDownloadId?: string
}

/** 酷我音乐（cover 搜索后可能异步补全） */
export interface KuwoMusicItem extends BaseMusicItem {
  type: 'kw'
}

/** JOOX */
export interface JooxMusicItem extends BaseMusicItem {
  type: 'joox'
  mid?: string
}

/** 本地文件（「添加本地歌曲」导入）。id 为文件路径哈希（确定性，重复导入自动去重）。 */
export interface LocalMusicItem extends BaseMusicItem {
  type: 'local'
  filePath: string
}

/**
 * 本地文件（「添加本地歌曲」导入）。id 为文件路径哈希（确定性，重复导入自动去重）。
 */
export interface LocalMusicItem extends BaseMusicItem {
  type: 'local'
  filePath: string
}

export type MusicItem =
  NeteaseMusicItem | QQMusicItem | KugouMusicItem | KuwoMusicItem | JooxMusicItem | LocalMusicItem

/** 唯一键：一般为 `type_id`，酷狗优先 `kg_hash`。 */
export function getMusicItemKey(item: MusicItem): string {
  if (item.type === 'kg' && item.hash) return `kg_${item.hash}`
  // 酷狗歌词直链重定向目标（RedirectDialog buildKgTarget）没有 hash 且 id 恒为 0，
  // 不区分会让所有此类目标共享 `kg_0` 一个键（歌词缓存互相串）；用 downloadId 区分
  if (item.type === 'kg' && item.lyricDownloadId) return `kg_lyric_${item.lyricDownloadId}`
  return `${item.type}_${item.id}`
}

/**
 * 原始歌词容器（对应 Lyric.kt）—— Provider.getLyric 的返回，数据获取层产物。
 * 空串表示无该项。渲染层再交给 music-lyric-kit 解析。
 */
export interface Lyric {
  /** 主歌词（LRC / 增强 LRC / YRC 归一化后） */
  lrc: string
  /** 翻译 */
  trans: string
  /** 音译（罗马音） */
  roma: string
  /** 逐字 */
  char: string
  /** 逐字音译 */
  chroma: string
  /** AI 谐音 */
  phonetic: string
}

/**
 * 酷狗歌词候选（歌词重定向对话框用，对应安卓 KgProvider.KgLyricCandidate）。
 * typeBadges 为探测出的歌词内容类型徽标（逐字/逐行/翻译/音译/逐字音译/谐音）。
 */
export interface KgLyricCandidate {
  accessKey: string
  downloadId: string
  contenttype: number
  song: string
  singer: string
  language: string
  durationMs: number
  score: number
  typeBadges: string[]
}

/** 空歌词 */
export const EMPTY_LYRIC: Lyric = {
  lrc: '',
  trans: '',
  roma: '',
  char: '',
  chroma: '',
  phonetic: ''
}
