/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * QQ 音乐云 Provider（qqc）。
 *
 * 搜索走自建后端 ClickHouse（c.wwwweb.top/music/search），其余与 QQ 音乐保持一致：
 * 产出标准 QQMusicItem（type='qq'），播放地址 / 歌词 / 音质 / 封面全部复用 qq 链路。
 *
 * 搜索返回的条目只带 id/mid/name/artist/album/albummid，缺 duration/cover/qualities，
 * 故按 id 批量调 CgiGetTrackInfo 补全（types 每首歌一个 1，对齐后端 tencent.GetMusicInfo）。
 */
import type { MusicItem, MusicListResult, QQMusicItem } from '@common'
import { BaseProvider } from '../base'
import { requestJson } from '../../net/request'
import { parseTrackInfo } from '../qq/item'
import { zzcRequest } from '../qq'

const SEARCH_ENDPOINT = 'https://c.wwwweb.top/music/search'

interface QqcSearchItem {
  id?: number
  mid?: string
  name?: string
  artist?: string
  album?: string
  albumid?: number
  albummid?: string
}

interface QqcSearchResponse {
  code?: number
  total?: number
  data?: QqcSearchItem[]
}

export class QqcProvider extends BaseProvider {
  readonly source = 'qqc' as const
  readonly displayName = 'QQ音乐云'

  async search(keyword: string, page = 0, size = 20): Promise<MusicListResult> {
    const json = await requestJson<QqcSearchResponse>(SEARCH_ENDPOINT, {
      method: 'POST',
      body: { keyword, page: page + 1, limit: size }
    }).catch(() => null)

    if (!json || json.code !== 200 || !Array.isArray(json.data)) {
      return this.emptyList(page, size)
    }

    const list = json.data
    const ids = list.map((x) => Number(x?.id)).filter((n) => Number.isFinite(n) && n > 0)
    const details = await this.fetchSongDetailsBatch(ids)

    const byId = new Map<number, QQMusicItem>()
    for (const item of details) byId.set(item.id, item)

    const result: MusicItem[] = list.map((x) => {
      const id = Number(x?.id)
      return Number.isFinite(id) && id > 0 && byId.has(id)
        ? (byId.get(id) as QQMusicItem)
        : this.toPlaceholder(x)
    })

    const total = Number(json.total) || 0
    return { source: 'qqc', hasNext: (page + 1) * size < total, page, size, result }
  }

  /** 补全失败时的兜底条目：仅用搜索字段构造，时长/音质为空（后续可正常取流/歌词）。 */
  private toPlaceholder(x: QqcSearchItem): QQMusicItem {
    const id = Number(x?.id) || 0
    const mid = x?.mid ?? ''
    const albumMid = x?.albummid ?? ''
    const albumIdNum = Number(x?.albumid) || 0
    return {
      type: 'qq',
      id,
      title: x?.name ?? '',
      artist: x?.artist ?? '',
      album: x?.album ?? '',
      albumId: albumMid || (albumIdNum > 0 ? String(albumIdNum) : undefined),
      cover: albumMid ? `https://y.gtimg.cn/music/photo_new/T002R800x800M000${albumMid}.jpg` : '',
      duration: 0,
      qualities: {},
      mid,
      albumMid,
      mediaMid: ''
    }
  }

  /** 批量查完整 track_info（含 mid、mediaMid、各音质与正确封面），保持输入顺序。 */
  private async fetchSongDetailsBatch(ids: number[]): Promise<QQMusicItem[]> {
    if (ids.length === 0) return []
    const reqData = {
      comm: { ct: 19, cv: 1859, uin: 0 },
      req: {
        module: 'music.trackInfo.UniformRuleCtrl',
        method: 'CgiGetTrackInfo',
        param: {
          ids,
          types: ids.map(() => 1)
        }
      }
    }
    const json = await zzcRequest<any>(reqData).catch(() => null)
    const tracks = json?.req?.data?.tracks
    if (!Array.isArray(tracks)) return []

    const out: QQMusicItem[] = []
    const seen = new Set<number>()
    for (const track of tracks) {
      const item = parseTrackInfo(track)
      if (item && !seen.has(item.id)) {
        seen.add(item.id)
        out.push(item)
      }
    }
    return out
  }
}
