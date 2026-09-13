/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 网易云音乐 Provider（1:1 移植自 Android WyProvider.kt）。
 * 播放地址不在此解析，走后端 getUrl（platform=wyy, musicId=数字 id）。
 */
import {
  EMPTY_LYRIC,
  type AlbumInfoResult,
  type AlbumSearchResult,
  type ArtistInfoResult,
  type ArtistMvItem,
  type ArtistMvResult,
  type ArtistSearchResult,
  type CommentResult,
  type Lyric,
  type MusicItem,
  type MusicListResult,
  type MvQuality,
  type MvUrlResult,
  type NeteaseMusicItem,
  type PlayListInfoResult,
  type UserInfo
} from '@common'
import { BaseProvider } from '../base'
import { requestJson } from '../../net/request'
import { eapiPost, extractMusicU, weapiPost } from '../../crypto/netease'
import { parseYrc } from '../../crypto/lyric'
import { enrichFromQualityDetail, num, parseTrackInfo } from './item'
import { wyGetComment, wyGetHotComment } from './comment'

/** 字节 → MB/GB 显示（MV 音质档用）。 */
function formatMvSize(bytes: number): string {
  const mb = bytes / 1024 / 1024
  return mb >= 1024 ? `${(mb / 1024).toFixed(2)}GB` : `${mb.toFixed(1)}MB`
}

export class WyProvider extends BaseProvider {
  readonly source = 'wy' as const
  readonly displayName = '网易云音乐'

  /** 歌单全量 trackIds 缓存（对应 playlistCache） */
  private playlistCache = new Map<string, number[]>()

  private getMusicU(): string | undefined {
    const cookie = this.credentials?.cookie
    if (!cookie) return undefined
    return extractMusicU(cookie) ?? cookie
  }

  // —— 搜索 ——
  async search(keyword: string, page = 0, size = 20): Promise<MusicListResult> {
    const apiPage = page + 1
    const json = await eapiPost('/api/search/song/list/page', {
      keyword,
      needCorrect: '1',
      channel: 'typing',
      offset: size * (apiPage - 1),
      scene: 'normal',
      total: apiPage === 1,
      limit: size
    }).catch(() => null)
    if (!json || json.code !== 200) return this.emptyList(page, size)
    const resources: any[] = json.data?.resources ?? []
    const totalCount = num(json.data?.totalCount, 0)
    const items = resources
      .map((r) => parseTrackInfo(r?.baseInfo?.simpleSongData))
      .filter((x): x is NeteaseMusicItem => !!x)
    const result = await this.enrichAll(items)
    return { source: 'wy', hasNext: apiPage * size < totalCount, page, size, result }
  }

  async getHotSearch(): Promise<string[]> {
    const json = await weapiPost('/api/search/hot', { type: 1111 }).catch(() => null)
    if (!json || json.code !== 200) return []
    return (json.result?.hots ?? [])
      .map((h: any) => h?.first)
      .filter((x: any): x is string => typeof x === 'string')
  }

  async getSearchTip(keyword: string): Promise<string[]> {
    const json = await weapiPost('/api/search/suggest/keyword', { s: keyword, limit: 8 }).catch(
      () => null
    )
    if (!json || json.code !== 200) return []
    return (json.result?.allMatch ?? [])
      .map((m: any) => m?.keyword)
      .filter((x: any): x is string => typeof x === 'string')
  }

  async searchAlbum(keyword: string, page = 0, size = 20): Promise<AlbumSearchResult> {
    const json = await eapiPost('/api/v1/search/album/get', {
      s: keyword,
      limit: String(size),
      offset: String(page * size),
      channel: 'typing',
      queryCorrect: 'false',
      q_scene: 'typing',
      checkToken: 'firstRequest',
      sub: 'false'
    }).catch(() => null)
    if (!json || json.code !== 200) return this.emptyPage(page, size)
    const total = num(json.result?.albumCount, 0)
    const result = (json.result?.albums ?? [])
      .map((a: any) => this.parseAlbumEntry(a))
      .filter((x: any): x is AlbumInfoResult => !!x)
    return { source: 'wy', hasNext: (page + 1) * size < total, page, size, result }
  }

  async searchArtist(keyword: string, page = 0, size = 20): Promise<ArtistSearchResult> {
    const json = await eapiPost('/api/v1/search/artist/get', {
      s: keyword,
      limit: String(size),
      offset: String(page * size),
      channel: 'defaultquery',
      queryCorrect: 'false',
      q_scene: 'defaultquery',
      checkToken: 'firstRequest',
      sub: 'false',
      e_r: false
    }).catch(() => null)
    if (!json || json.code !== 200) return this.emptyPage(page, size)
    const total = num(json.result?.artistCount, 0)
    const result = (json.result?.artists ?? [])
      .map((a: any) => this.parseArtistEntry(a))
      .filter((x: any): x is ArtistInfoResult => !!x)
    return { source: 'wy', hasNext: (page + 1) * size < total, page, size, result }
  }

  // —— 歌单 ——
  async getPlayListInfo(input: string): Promise<PlayListInfoResult | null> {
    const id = this.extractPlaylistId(input)
    if (!id) return null
    const json = await eapiPost(
      '/api/v6/playlist/detail',
      { id: Number(id) || id, n: 0, s: 8 },
      this.getMusicU()
    ).catch(() => null)
    if (!json || json.code !== 200 || !json.playlist) return null
    const pl = json.playlist
    return {
      source: 'wy',
      id,
      name: pl.name,
      cover: pl.coverImgUrl,
      creator: pl.creator?.nickname,
      description: pl.description,
      total: num(pl.trackCount, 0)
    }
  }

  async getPlayListSongs(playListId: string, page = 0, size = 30): Promise<MusicListResult> {
    let trackIds = this.playlistCache.get(playListId)
    if (!trackIds) {
      trackIds = await this.fetchAllTrackIds(playListId)
      this.playlistCache.set(playListId, trackIds)
    }
    const from = page * size
    if (from >= trackIds.length) {
      this.playlistCache.delete(playListId)
      return this.emptyList(page, size)
    }
    const to = Math.min(from + size, trackIds.length)
    const items = await this.fetchSongDetails(trackIds.slice(from, to))
    const result = await this.enrichAll(items)
    const hasNext = to < trackIds.length
    if (!hasNext) this.playlistCache.delete(playListId)
    return { source: 'wy', hasNext, page, size, total: trackIds.length, result }
  }

  // —— 专辑 ——
  async getAlbumInfo(albumId: string): Promise<AlbumInfoResult | null> {
    const p = await this.fetchAlbumPayload(albumId)
    const al = p?.album
    if (!al?.name) return null
    return {
      source: 'wy',
      id: albumId,
      name: al.name,
      cover: al.picUrl,
      artist: al.artist?.name,
      publishTime: al.publishTime != null ? String(al.publishTime) : undefined,
      description: al.description,
      total: num(al.size, 0)
    }
  }

  async getAlbumSongs(albumId: string): Promise<MusicListResult> {
    const p = await this.fetchAlbumPayload(albumId)
    if (!p) return this.emptyList()
    const items = (p.songs ?? [])
      .map((s: any) => parseTrackInfo(s))
      .filter((x: any): x is NeteaseMusicItem => !!x)
    const result = await this.enrichAll(items)
    return { source: 'wy', hasNext: false, page: 0, size: result.length, result }
  }

  // —— 歌手 ——
  async getArtistInfo(artistId: string): Promise<ArtistInfoResult | null> {
    const idJson = JSON.stringify({ id: String(artistId) })
    const batch = JSON.stringify({
      e_r: false,
      '/api/artist/head/info/get': idJson,
      '/api/artist/follow/count/get': idJson
    })
    const json = await eapiPost('/api/batch', batch).catch(() => null)
    if (!json || json.code !== 200) return null
    const head = json['/api/artist/head/info/get']
    if (!head || head.code !== 200) return null
    const a = head.data?.artist
    if (!a?.name) return null
    const follow = json['/api/artist/follow/count/get']
    return {
      source: 'wy',
      id: artistId,
      name: a.name,
      cover: a.avatar ?? a.cover,
      description: a.briefDesc,
      songCount: num(a.musicSize, 0),
      albumCount: num(a.albumSize, 0),
      fansCount: num(follow?.data?.fansCnt, 0)
    }
  }

  async getArtistSongs(artistId: string, page = 0, size = 30): Promise<MusicListResult> {
    const json = await eapiPost('/api/v1/artist/top/song', {
      id: String(artistId),
      order: 'hot',
      top: String(size),
      work_type: '5',
      e_r: false
    }).catch(() => null)
    if (!json || json.code !== 200) return this.emptyList(page, size)
    const items = (json.songs ?? [])
      .map((s: any) => parseTrackInfo(s))
      .filter((x: any): x is NeteaseMusicItem => !!x)
    const result = await this.enrichAll(items)
    return { source: 'wy', hasNext: !!json.more, page, size, result }
  }

  supportsArtistAlbums(): boolean {
    return true
  }
  supportsArtistMvs(): boolean {
    return true
  }

  async getArtistAlbums(artistId: string, page = 0, size = 30): Promise<AlbumSearchResult> {
    const id = Number(artistId)
    if (!Number.isFinite(id)) return this.emptyPage(page, size)
    const json = await eapiPost(`/api/artist/albums/${id}`, {
      id,
      offset: page * size,
      limit: size,
      total: true
    }).catch(() => null)
    if (!json || json.code !== 200) return this.emptyPage(page, size)
    const total = num(json.artist?.albumSize, 0)
    const result = (json.hotAlbums ?? [])
      .map((a: any) => this.parseAlbumEntry(a))
      .filter((x: any): x is AlbumInfoResult => !!x)
    return { source: 'wy', hasNext: (page + 1) * size < total, page, size, result }
  }

  async getArtistMvs(artistId: string, page = 0, size = 40): Promise<ArtistMvResult> {
    const empty: ArtistMvResult = { source: 'wy', hasNext: false, page, size, total: 0, result: [] }
    const id = Number(artistId)
    if (!Number.isFinite(id)) return empty
    const json = await eapiPost('/api/artist/mvs', {
      artistId: id,
      offset: page * size,
      limit: size,
      total: true
    }).catch(() => null)
    if (!json || json.code !== 200) return empty
    const result: ArtistMvItem[] = []
    for (const o of json.mvs ?? []) {
      if (o?.id == null) continue
      result.push({
        source: 'wy',
        vid: String(o.id),
        title: o.name ?? '',
        cover: o.imgurl16v9 ?? o.imgurl ?? '',
        duration: Math.round(num(o.duration, 0) / 1000),
        playCount: num(o.playCount, 0),
        pubTime: Date.parse(o.publishTime ?? '') || 0
      })
    }
    return {
      source: 'wy',
      hasNext: !!json.hasMore,
      page,
      size,
      total: num(json.total, 0),
      result
    }
  }

  createMvItem(vid: string, title: string, cover: string): MusicItem {
    return {
      type: 'wy',
      id: 0,
      title,
      artist: '',
      album: '',
      cover,
      duration: 0,
      qualities: { standard: { id: 'standard', name: '标准', filesize: 0, bitrate: 128 } },
      mvid: vid
    }
  }

  // —— 用户 ——
  async getUserPlaylist(): Promise<PlayListInfoResult[]> {
    const musicU = this.getMusicU()
    if (!musicU) return []
    const acc = await eapiPost('/api/nuser/account/get', {}, musicU).catch(() => null)
    const uid = num(acc?.account?.id, 0)
    if (!acc || acc.code !== 200 || !uid) return []
    const json = await eapiPost(
      '/api/user/playlist',
      { uid, limit: 100, offset: 0, includeVideo: true },
      musicU
    ).catch(() => null)
    if (!json || json.code !== 200) return []
    return (json.playlist ?? []).map((pl: any) => ({
      source: 'wy' as const,
      id: String(pl.id),
      name: pl.name,
      cover: pl.coverImgUrl,
      creator: pl.creator?.nickname,
      description: pl.description,
      total: num(pl.trackCount, 0)
    }))
  }

  async getUserInfo(): Promise<UserInfo | null> {
    const musicU = this.getMusicU()
    if (!musicU) return null
    const json = await eapiPost('/api/nuser/account/get', {}, musicU).catch(() => null)
    const p = json?.profile
    if (!json || json.code !== 200 || !p) return null
    return {
      source: 'wy',
      uid: String(p.userId ?? ''),
      nickname: p.nickname,
      avatar: p.avatarUrl ?? ''
    }
  }

  // —— MV ——（移植 WyProvider.getMvQualities/getMvUrl）
  async getMvQualities(item: MusicItem): Promise<MvQuality[]> {
    const mvid = item.mvid?.trim()
    if (!mvid || mvid === '0') return []
    const brMap: [number, string][] = [
      [1080, '蓝光画质'],
      [720, '超清画质'],
      [480, '高清画质'],
      [240, '标清画质']
    ]
    const json = await requestJson<any>(`https://music.163.com/api/v1/mv/detail?id=${mvid}`).catch(
      () => null
    )
    const brs = json?.data?.brs
    if (!Array.isArray(brs)) return []
    const out: MvQuality[] = []
    for (const o of brs) {
      const br = num(o?.br, 0)
      if (!br) continue
      const name = brMap.find((m) => m[0] === br)?.[1] ?? `其他(${br})`
      const sizeBytes = num(o?.size, 0)
      const displaySize = sizeBytes > 0 ? formatMvSize(sizeBytes) : ''
      out.push({ quality: String(br), displayName: name, displaySize })
    }
    return out.sort(
      (a, b) =>
        brMap.findIndex((m) => String(m[0]) === a.quality) -
        brMap.findIndex((m) => String(m[0]) === b.quality)
    )
  }

  async getMvUrl(item: MusicItem, quality: string): Promise<MvUrlResult> {
    const mvid = item.mvid?.trim()
    if (!mvid || mvid === '0')
      return { source: 'wy', playUrl: null, quality, rejectReason: '无 mvid' }
    const json = await requestJson<any>(
      `https://music.163.com/api/song/enhance/play/mv/url?id=${mvid}&r=${quality}`
    ).catch(() => null)
    const url = json?.data?.url
    if (typeof url === 'string' && url) return { source: 'wy', playUrl: url, quality }
    return { source: 'wy', playUrl: null, quality, rejectReason: 'url 为空' }
  }

  // —— 歌词 ——（仅把接口返回的字段透传给渲染层解析引擎）
  async getLyric(item: MusicItem): Promise<Lyric> {
    const json = await eapiPost('/api/song/lyric/v1', {
      id: String(item.id),
      cp: false,
      tv: 0,
      lv: 0,
      rv: 0,
      kv: 0,
      yv: 0,
      ytv: 0,
      yrv: 0
    }).catch(() => null)
    // 源码仅以 json.has("lrc") 为门（字段存在即可，不看内容/code）；纯 yrc 歌也应产出
    if (!json || json.lrc == null) return { ...EMPTY_LYRIC }
    const yrc = json.yrc?.lyric ?? ''
    const hasYrc = yrc.length > 0
    // 有 yrc 时（对齐安卓 parseWy 路径 1）：行级 lrc 与逐字 char 均由 yrc 网格产出，
    // 保证主/逐字时间戳一致；翻译/音译取与网格对齐的 ytlrc/yromalrc。
    const parsedYrc = hasYrc ? parseYrc(yrc) : null
    return {
      lrc: parsedYrc ? parsedYrc.lyric : (json.lrc?.lyric ?? ''),
      trans: (hasYrc ? json.ytlrc?.lyric : json.tlyric?.lyric) ?? '',
      roma: (hasYrc ? json.yromalrc?.lyric : json.romalrc?.lyric) ?? '',
      char: parsedYrc ? parsedYrc.chase : '',
      chroma: '',
      phonetic: ''
    }
  }

  // —— 私有 ——
  private parseAlbumEntry(o: any): AlbumInfoResult | null {
    if (o?.id == null || !o.name) return null
    return {
      source: 'wy',
      id: String(o.id),
      name: o.name,
      cover: o.picUrl,
      artist: o.artist?.name,
      publishTime: o.publishTime != null ? String(o.publishTime) : undefined,
      description: o.description,
      total: num(o.size, 0)
    }
  }

  private parseArtistEntry(o: any): ArtistInfoResult | null {
    if (o?.id == null || !o.name) return null
    return {
      source: 'wy',
      id: String(o.id),
      name: o.name,
      cover: o.picUrl ?? o.img1v1Url,
      songCount: num(o.musicSize, 0),
      albumCount: num(o.albumSize, 0)
    }
  }

  private async fetchAlbumPayload(albumId: string): Promise<any | null> {
    const json = await requestJson<any>(
      `https://interface3.music.163.com/api/v1/album/${albumId}`
    ).catch(() => null)
    return json && json.code === 200 ? json : null
  }

  private async fetchAllTrackIds(id: string): Promise<number[]> {
    const json = await eapiPost(
      '/api/v6/playlist/detail',
      { id: Number(id) || id, n: 0, s: 0 },
      this.getMusicU()
    ).catch(() => null)
    if (!json || json.code !== 200) return []
    return (json.playlist?.trackIds ?? [])
      .map((t: any) => num(t?.id, 0))
      .filter((x: number) => x > 0)
  }

  private async fetchSongDetails(ids: number[]): Promise<NeteaseMusicItem[]> {
    const out: NeteaseMusicItem[] = []
    for (let i = 0; i < ids.length; i += 100) {
      const c = ids
        .slice(i, i + 100)
        .map((id) => `{"id":${id}}`)
        .join(',')
      const json = await weapiPost('/api/v3/song/detail', { c: `[${c}]` }).catch(() => null)
      if (json?.code === 200) {
        for (const s of json.songs ?? []) {
          const it = parseTrackInfo(s)
          if (it) out.push(it)
        }
      }
    }
    return out
  }

  /** 按 id 查单曲（歌词重定向对话框用，移植 WyProvider.fromID：detail + 音质补全） */
  async fromId(id: number): Promise<NeteaseMusicItem | null> {
    const items = await this.fetchSongDetails([id])
    const item = items[0]
    if (!item) return null
    const [enriched] = await this.enrichAll([item]).catch(() => [item])
    return enriched ?? item
  }

  /** batch + "/" hack 批量补高级音质 */
  private async enrichAll(items: NeteaseMusicItem[]): Promise<NeteaseMusicItem[]> {
    if (!items.length) return items
    const basePath = '/api/song/music/detail/get'
    const keys = items.map((_, i) => basePath + '/'.repeat(i))
    const parts = items.map(
      (it, i) => `${JSON.stringify(keys[i])}:${JSON.stringify(`{'songId':${it.id}}`)}`
    )
    const json = await eapiPost('/api/batch', `{${parts.join(',')}}`).catch(() => null)
    if (!json || json.code !== 200) return items
    return items.map((it, i) => (json[keys[i]] ? enrichFromQualityDetail(it, json[keys[i]]) : it))
  }

  private extractPlaylistId(input: string): string | null {
    const t = input.trim()
    if (/^\d+$/.test(t)) return t
    const urlM = /https?:\/\/\S+/.exec(t)
    const url = urlM ? urlM[0] : t
    for (const re of [
      /[?&]id=(\d+)/,
      /\/playlist\/(\d+)/,
      /#\/playlist\?id=(\d+)/,
      /\/discover\/toplist\?id=(\d+)/
    ]) {
      const m = re.exec(url)
      if (m) return m[1]
    }
    return null
  }

  // —— 评论 ——
  supportsComment(): boolean {
    return true
  }
  async getComment(item: MusicItem, page = 1, limit = 20): Promise<CommentResult> {
    return wyGetComment(item, page, limit)
  }
  async getHotComment(item: MusicItem, page = 1, limit = 20): Promise<CommentResult> {
    return wyGetHotComment(item, page, limit)
  }
}
