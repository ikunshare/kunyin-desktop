/**
 * 音源统一数据模型（对应 Android 端 model/MusicItem.kt、Quality.kt、Singer.kt、Lyric.kt）
 *
 * 主进程各音源 Provider 产出这些结构，经 IPC 传给渲染层。
 * `MusicItem` 为按 `type` 分发的可辨识联合（discriminated union）。
 */

/** 音源标识（反序列化分发用）。注意：与后端 getUrl 的 platform 名不同，映射见 crypto/请求层。 */
export type MusicSource = 'wy' | 'qq' | 'kg' | 'kw' | 'joox'

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
  singerId: number
  extra?: string
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

export type MusicItem =
  NeteaseMusicItem | QQMusicItem | KugouMusicItem | KuwoMusicItem | JooxMusicItem

/** 唯一键：一般为 `type_id`，酷狗优先 `kg_hash`。 */
export function getMusicItemKey(item: MusicItem): string {
  if (item.type === 'kg' && item.hash) return `kg_${item.hash}`
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

/** 空歌词 */
export const EMPTY_LYRIC: Lyric = {
  lrc: '',
  trans: '',
  roma: '',
  char: '',
  chroma: '',
  phonetic: ''
}
