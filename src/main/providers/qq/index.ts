/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * QQ 音乐 Provider（移植自 QQProvider.kt）。
 * 业务接口走 musics.fcg（POST JSON + zzc 签名，见 sign.ts）。设备指纹/QIMEI 仅上报用，忽略。
 * 注：Android 端用无签名 musicu.fcg（真机环境可过）；桌面/数据中心 IP 必须签名走 musics.fcg。
 * 播放走后端 getUrl（platform=qq, musicId=mid）。歌词见 lyric.ts（Task 19，QRC 3DES）。
 */
import { randomUUID } from 'node:crypto'
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
  type PlayListInfoResult,
  type QQMusicItem,
  type UserInfo
} from '@common'
import { BaseProvider, type ProviderCredentials } from '../base'
import { requestJson } from '../../net/request'
import { qqRefreshCredential, type QQCredentials } from '../../auth/login/qq'
import { num, parseTrackInfo, stripEm } from './item'
import { qqComm } from './comm'
import { zzcSign } from './sign'
import { decodeLegacyLyric, isLyricEmpty, parseTxLyric } from './lyric'
import { qqGetComment, qqGetHotComment } from './comment'

function pcSearchId(): string {
  const uuid = randomUUID().replace(/-/g, '').toUpperCase()
  return uuid + String(Math.floor(Math.random() * 100000)).padStart(5, '0')
}

/** 字节 → MB/GB 显示（MV 音质档用）。 */
function qqFormatSize(bytes: number): string {
  const mb = bytes / 1024 / 1024
  return mb >= 1024 ? `${(mb / 1024).toFixed(2)}GB` : `${mb.toFixed(1)}MB`
}

/** 清洗发行日期：`0000-…`（QQ 的未知日期占位）与空值归一为 undefined，年份由渲染层截取。 */
function qqDate(raw: unknown): string | undefined {
  if (typeof raw === 'number') return raw > 0 ? String(raw) : undefined
  const s = typeof raw === 'string' ? raw.trim() : ''
  return s && !s.startsWith('0000') ? s : undefined
}

export async function zzcRequest<T = any>(reqData: Record<string, unknown>): Promise<T> {
  // 签名走 musics.fcg：sign 对实际发送的 body 字节计算，故先 stringify 一次
  const text = JSON.stringify(reqData)
  const sign = zzcSign(text)
  return requestJson<T>(`https://u6.y.qq.com/cgi-bin/musics.fcg?sign=${sign}`, {
    method: 'POST',
    headers: {
      'User-Agent': 'QQMusic/2104583050',
      'Content-Type': 'application/json',
      Referer: 'https://y.qq.com/'
    },
    body: text
  })
}

export class QqProvider extends BaseProvider {
  readonly source = 'qq' as const
  readonly displayName = 'QQ音乐'

  async search(keyword: string, page = 0, size = 20): Promise<MusicListResult> {
    // 源码走 musicu.fcg 的 music.search.SearchCgiService（旧 client_search_cp 端点对数据中心 IP 常年空）。
    const req = {
      comm: qqComm('search', this.credentials, {
        psrf_access_token_expiresAt: 0,
        psrf_qqaccess_token: '',
        psrf_qqopenid: '',
        psrf_qqunionid: '',
        tmeLoginType: 0,
        uin: '0'
      }),
      'music.search.SearchCgiService': {
        module: 'music.search.SearchCgiService',
        method: 'DoSearchForQQMusicDesktop',
        param: {
          grp: 1,
          num_per_page: size,
          page_num: page + 1,
          query: keyword,
          remoteplace: 'txt.newclient.top',
          search_type: 0,
          searchid: pcSearchId()
        }
      }
    }
    const json = await zzcRequest<any>(req).catch(() => null)
    const data = json?.['music.search.SearchCgiService']?.data ?? json?.req?.data
    if (!data) return this.emptyList(page, size)
    const list = data.body?.song?.list ?? data.body?.item_song ?? []
    const seen = new Set<number>()
    const result = list
      .map((x: any) => parseTrackInfo(x))
      .filter((x: any): x is QQMusicItem => !!x && !seen.has(x.id) && (seen.add(x.id), true))
    const hasNext = num(data.meta?.nextpage, -1) > page
    return { source: 'qq', hasNext, page, size, result }
  }

  async getHotSearch(): Promise<string[]> {
    const req = {
      comm: qqComm('hotkey'),
      hotkey: {
        module: 'tencent_musicsoso_hotkey.HotkeyService',
        method: 'GetHotkeyForQQMusicPC',
        param: { uin: 0, search_id: '' }
      }
    }
    const json = await zzcRequest<any>(req).catch(() => null)
    if (!json || json.hotkey?.code !== 0) return []
    return (json.hotkey.data?.vec_hotkey ?? [])
      .map((h: any) => h?.query)
      .filter((x: any): x is string => !!x)
  }

  async getSearchTip(keyword: string): Promise<string[]> {
    const req = {
      comm: qqComm('smartbox'),
      req: {
        module: 'tencent_music_soso_smartbox_cgi.SmartBoxCgi',
        method: 'GetSmartBoxResultForXiaomi',
        param: { search_id: '0', query: keyword, num_per_page: 15, page_idx: 1, uin: 0 }
      }
    }
    const json = await zzcRequest<any>(req).catch(() => null)
    if (!json || json.req?.code !== 0) return []
    return (json.req.data?.items ?? [])
      .map((i: any) => i?.hint)
      .filter((x: any): x is string => !!x)
  }

  async searchAlbum(keyword: string, page = 0, size = 20): Promise<AlbumSearchResult> {
    const req = {
      comm: qqComm('searchAlbum', this.credentials),
      'music.search.SearchCgiService': {
        module: 'music.search.SearchCgiService',
        method: 'DoSearchForQQMusicDesktop',
        param: {
          grp: 1,
          num_per_page: size,
          page_num: page + 1,
          query: keyword,
          remoteplace: 'sizer.newclient.album',
          search_type: 2,
          searchid: ''
        }
      }
    }
    const json = await zzcRequest<any>(req).catch(() => null)
    const data = json?.['music.search.SearchCgiService']?.data
    if (!data) return this.emptyPage(page, size)
    const total = num(data.meta?.sum, 0)
    const result = (data.body?.album?.list ?? [])
      .map((a: any) => this.parseAlbumEntry(a))
      .filter((x: any): x is AlbumInfoResult => !!x)
    return { source: 'qq', hasNext: (page + 1) * size < total, page, size, result }
  }

  async searchArtist(keyword: string, page = 0, size = 20): Promise<ArtistSearchResult> {
    const req = {
      comm: qqComm('search', this.credentials),
      'music.search.SearchCgiService': {
        module: 'music.search.SearchCgiService',
        method: 'DoSearchForQQMusicDesktop',
        param: {
          grp: 1,
          num_per_page: size,
          page_num: page + 1,
          query: keyword,
          remoteplace: 'sizer.newclient.singer',
          search_type: 1,
          searchid: pcSearchId()
        }
      }
    }
    const json = await zzcRequest<any>(req).catch(() => null)
    const data = json?.['music.search.SearchCgiService']?.data
    if (!data) return this.emptyPage(page, size)
    const total = num(data.meta?.sum, 0)
    const result = (data.body?.singer?.list ?? [])
      .map((a: any) => this.parseSingerEntry(a))
      .filter((x: any): x is ArtistInfoResult => !!x)
    return { source: 'qq', hasNext: (page + 1) * size < total, page, size, result }
  }

  async getPlayListInfo(input: string): Promise<PlayListInfoResult | null> {
    const dissId = this.extractDissId(input)
    if (!dissId) return null
    const req = {
      comm: qqComm('asset', this.credentials),
      req: {
        module: 'music.srfDissInfo.DissInfo',
        method: 'CgiGetDiss',
        param: {
          disstid: Number(dissId) || dissId,
          song_num: 0,
          song_begin: 0,
          from: 15,
          ctx: 0,
          onlysonglist: 0,
          orderlist: 1,
          tag: 1,
          rec_flag: 1,
          new_format: 1
        }
      }
    }
    const json = await zzcRequest<any>(req).catch(() => null)
    const data = json?.req?.data
    if (!data) return null
    const dir = data.dirinfo ?? data
    const author = typeof dir.creator === 'object' ? dir.creator?.name : dir.creator
    return {
      source: 'qq',
      id: dissId,
      name: dir.title,
      cover: dir.picurl ?? dir.logo,
      creator: author,
      description: dir.desc,
      total: num(data.total_song_num ?? dir.songnum, 0)
    }
  }

  async getPlayListSongs(playListId: string, page = 0, size = 30): Promise<MusicListResult> {
    const req = {
      comm: qqComm('asset', this.credentials),
      req: {
        module: 'music.srfDissInfo.DissInfo',
        method: 'CgiGetDiss',
        param: {
          disstid: Number(playListId) || playListId,
          song_num: size,
          song_begin: page * size,
          from: 15,
          ctx: 0,
          onlysonglist: 0,
          orderlist: 1,
          tag: 1,
          rec_flag: 1,
          new_format: 1
        }
      }
    }
    const json = await zzcRequest<any>(req).catch(() => null)
    const data = json?.req?.data
    if (!data) return this.emptyList(page, size)
    const total = num(data.total_song_num ?? data.songnum, 0)
    const seen = new Set<number>()
    const result = (data.songlist ?? [])
      .map((s: any) => parseTrackInfo(s))
      .filter((x: any): x is QQMusicItem => !!x && !seen.has(x.id) && (seen.add(x.id), true))
    return { source: 'qq', hasNext: (page + 1) * size < total, page, size, result }
  }

  async getAlbumInfo(albumMid: string): Promise<AlbumInfoResult | null> {
    const json = await this.fetchAlbumPayload(albumMid)
    const basic = json?.req_1?.data?.basicInfo
    if (!basic?.albumName) return null
    const data = json.req_1.data
    return {
      source: 'qq',
      id: albumMid,
      name: basic.albumName,
      cover: `https://y.gtimg.cn/music/photo_new/T002R800x800M000${albumMid}.jpg`,
      artist: data.singer?.singerList?.[0]?.name,
      publishTime: qqDate(basic.publishDate),
      description: basic.desc,
      total: num(json.req_2?.data?.totalNum, 0)
    }
  }

  async getAlbumSongs(albumMid: string): Promise<MusicListResult> {
    const json = await this.fetchAlbumPayload(albumMid)
    const list = json?.req_2?.data?.songList ?? []
    const result = list
      .map((el: any) => parseTrackInfo(el.songInfo))
      .filter((x: any): x is QQMusicItem => !!x)
    return { source: 'qq', hasNext: false, page: 0, size: result.length, result }
  }

  async getArtistInfo(singerMid: string): Promise<ArtistInfoResult | null> {
    const req = {
      comm: qqComm('wk', this.credentials),
      req_0: {
        module: 'music.musichallSinger.SingerInfoInter',
        method: 'GetSingerDetail',
        param: { singer_mids: [singerMid], pic: 1, group_singer: 1, wiki_singer: 1, ex_singer: 1 }
      },
      req_1: {
        module: 'music.musichallSong.SongListInter',
        method: 'GetSingerSongList',
        param: { singerMid, begin: 0, num: 1, order: 1 }
      },
      req_2: {
        module: 'music.musichallAlbum.AlbumListServer',
        method: 'GetAlbumList',
        param: { singerMid, order: 1, num: 1, begin: 0 }
      }
    }
    const json = await zzcRequest<any>(req).catch(() => null)
    const singer = json?.req_0?.data?.singer_list?.[0]
    const basic = singer?.basic_info
    if (!basic?.name) return null
    const mid = basic.singer_mid ?? singerMid
    return {
      source: 'qq',
      id: mid,
      name: basic.name,
      cover:
        singer.pic?.pic ?? `https://y.gtimg.cn/music/photo_new/T001R300x300M000${singerMid}.jpg`,
      description: singer.ex_info?.desc,
      songCount: num(json.req_1?.data?.totalNum, 0),
      albumCount: num(json.req_2?.data?.total, 0),
      fansCount: await this.fetchFansCount(mid)
    }
  }

  /** 匿名拉粉丝数（移植 fetchQqSingerFansCount）；失败给 0，头部不显示粉丝行。 */
  private async fetchFansCount(singerMid: string): Promise<number> {
    const url =
      `https://c6.y.qq.com/rsc/fcgi-bin/fcg_order_singer_getnum.fcg` +
      `?g_tk=5381&uin=0&format=json&inCharset=utf-8&outCharset=utf-8` +
      `&notice=0&platform=wk_v17&needNewCode=0&utf8=1&singermid=${singerMid}`
    const json = await requestJson<any>(url, {
      headers: { Referer: 'https://y.qq.com/wk_v17/', Accept: 'application/json' }
    }).catch(() => null)
    return num(json?.num, 0)
  }

  supportsArtistAlbums(): boolean {
    return true
  }
  supportsArtistMvs(): boolean {
    return true
  }

  async getArtistAlbums(singerMid: string, page = 0, size = 30): Promise<AlbumSearchResult> {
    const req = {
      comm: qqComm('wk', this.credentials),
      req_0: {
        module: 'music.musichallAlbum.AlbumListServer',
        method: 'GetAlbumList',
        param: { singerMid, order: 0, num: size, begin: page * size }
      }
    }
    const json = await zzcRequest<any>(req).catch(() => null)
    const data = json?.req_0?.data
    if (!data) return this.emptyPage(page, size)
    const total = num(data.total, 0)
    // GetAlbumList 的条目字段（albumMid/publishDate/albumType）与搜索结果不同，单独解析
    const result: AlbumInfoResult[] = []
    for (const o of data.albumList ?? []) {
      const albumMid = typeof o?.albumMid === 'string' ? o.albumMid.trim() : ''
      if (!albumMid || !o?.albumName) continue
      result.push({
        source: 'qq',
        id: albumMid,
        name: o.albumName,
        cover: `https://y.gtimg.cn/music/photo_new/T002R800x800M000${albumMid}.jpg`,
        artist: o.singerName,
        publishTime: qqDate(o.publishDate),
        subType: o.albumType || undefined
      })
    }
    return { source: 'qq', hasNext: (page + 1) * size < total, page, size, result }
  }

  async getArtistMvs(singerMid: string, page = 0, size = 40): Promise<ArtistMvResult> {
    const req = {
      comm: qqComm('wk', this.credentials),
      req_1: {
        module: 'MvService.MvInfoProServer',
        method: 'GetSingerMvList',
        param: { singermid: singerMid, tagid: 0, start: page * size, count: size, order: 0 }
      }
    }
    const json = await zzcRequest<any>(req).catch(() => null)
    const data = json?.req_1?.data
    if (!data) return { source: 'qq', hasNext: false, page, size, total: 0, result: [] }
    const total = num(data.total, 0)
    const result: ArtistMvItem[] = []
    for (const o of data.list ?? []) {
      const vid = typeof o?.vid === 'string' ? o.vid.trim() : ''
      if (!vid) continue
      result.push({
        source: 'qq',
        vid,
        title: o.title ?? '',
        cover: o.picurl ?? '',
        duration: num(o.duration, 0),
        playCount: num(o.playcnt, 0),
        pubTime: num(o.pubdate, 0) * 1000
      })
    }
    return { source: 'qq', hasNext: (page + 1) * size < total, page, size, total, result }
  }

  createMvItem(vid: string, title: string, cover: string): MusicItem {
    return {
      type: 'qq',
      id: 0,
      title,
      artist: '',
      album: '',
      cover,
      duration: 0,
      qualities: {},
      mid: '',
      albumMid: '',
      mediaMid: '',
      mvid: vid
    }
  }

  async getArtistSongs(singerMid: string, page = 0, size = 30): Promise<MusicListResult> {
    const req = {
      comm: qqComm('wkSongs', this.credentials),
      req_0: {
        module: 'music.musichallSong.SongListInter',
        method: 'GetSingerSongList',
        param: { singerMid, begin: page * size, num: size, order: 1 }
      }
    }
    const json = await zzcRequest<any>(req).catch(() => null)
    const data = json?.req_0?.data
    if (!data) return this.emptyList(page, size)
    const total = num(data.totalNum, 0)
    const result = (data.songList ?? [])
      .map((s: any) => parseTrackInfo(s.songInfo))
      .filter((x: any): x is QQMusicItem => !!x)
    return { source: 'qq', hasNext: (page + 1) * size < total, page, size, result }
  }

  async getUserInfo(): Promise<UserInfo | null> {
    const req = {
      comm: qqComm('asset', this.credentials),
      req: {
        module: 'music.UnifiedHomepage.UnifiedHomepageSrv',
        method: 'GetHomepageHeader',
        param: { IsQueryTabDetail: 1 }
      }
    }
    const json = await zzcRequest<any>(req).catch(() => null)
    const base = json?.req?.data?.Info?.BaseInfo
    if (!base?.Name) return null
    return { source: 'qq', uid: base.EncryptedUin ?? '', nickname: base.Name, avatar: base.Avatar }
  }

  /**
   * 启动时静默续期登录态（对应 QQProvider.refreshLogin → MobileQRLogin.refreshCredential）。
   * 成功返回换新后的凭据（musickey 会变），由 credentials.ts 落盘；失败返回 null、沿用旧凭据。
   */
  async refreshLogin(): Promise<ProviderCredentials | null> {
    const creds = this.credentials as unknown as Partial<QQCredentials> | null
    if (!creds?.authst || !creds?.uin) return null
    const refreshed = await qqRefreshCredential(creds as QQCredentials)
    // code=0 却没给 musickey 的畸形响应不能覆盖掉还能用的旧凭据
    if (!refreshed?.authst) return null
    const next = { ...refreshed } as unknown as ProviderCredentials
    this.credentials = next
    return next
  }

  /** 登录后拉「我的歌单」：自建 + 收藏（移植 QQProvider.getUserPlaylist，去掉推荐位装饰）。 */
  async getUserPlaylist(): Promise<PlayListInfoResult[]> {
    const creds = this.credentials as any
    if (!creds?.uin) return []
    const euin = (await this.getUserInfo())?.uid
    if (!euin) return []

    const reqData = {
      comm: qqComm('asset', creds),
      req1: {
        module: 'music.musicasset.PlaylistBaseRead',
        method: 'GetPlaylistByUin',
        param: {}
      },
      req2: {
        module: 'music.musicasset.PlaylistFavRead',
        method: 'CgiGetPlaylistFavInfo',
        param: { uin: euin, offset: 0, size: 9999 }
      }
    }
    const json = await zzcRequest<any>(reqData).catch(() => null)
    if (!json || Number(json.code) !== 0) return []

    const result: PlayListInfoResult[] = []
    const collect = (arr: any[] | undefined): void => {
      for (const pl of arr ?? []) {
        const parsed = this.parseUserPlaylistItem(pl)
        if (parsed) result.push(parsed)
      }
    }
    if (json.req1 && Number(json.req1.code) === 0) {
      collect(json.req1.data?.v_playlist)
    }
    if (json.req2 && Number(json.req2.code) === 0) {
      collect(json.req2.data?.v_list ?? json.req2.data?.v_playlist)
    }
    return result
  }

  private parseUserPlaylistItem(pl: any): PlayListInfoResult | null {
    const id = pl?.tid ?? pl?.dirid ?? pl?.id
    if (id == null) return null
    return {
      source: 'qq',
      id: String(id),
      name: String(pl.title ?? pl.dirName ?? pl.dirinfo?.title ?? '未命名'),
      cover: pl.picurl ?? pl.cover ?? pl.dirinfo?.picurl ?? '',
      creator: pl.nickname ?? pl.dirinfo?.host_nick ?? '',
      description: pl.desc ?? '',
      total: num(pl.songnum ?? pl.songNum ?? pl.dirinfo?.songnum, 0)
    }
  }

  // —— MV ——（移植 QQProvider.getMvQualities/getMvUrl，走签名 musics.fcg）
  private async fetchQqMvMp4Array(vid: string): Promise<any[] | null> {
    const req = {
      comm: qqComm('mv', this.credentials),
      request: {
        module: 'gosrf.Stream.MvUrlProxy',
        method: 'GetMvUrls',
        param: {
          vids: [vid],
          request_type: 10003,
          videoformat: 1,
          filetype: 30,
          format: 265,
          use_new_domain: 1
        }
      }
    }
    const json = await zzcRequest<any>(req).catch(() => null)
    const arr = json?.request?.data?.[vid]?.mp4
    return Array.isArray(arr) ? arr : null
  }

  async getMvQualities(item: MusicItem): Promise<MvQuality[]> {
    const vid = item.mvid?.trim()
    if (!vid) return []
    const ftMap: [number, string][] = [
      [40, '蓝光画质'],
      [30, '超清画质'],
      [20, '高清画质'],
      [10, '标清画质']
    ]
    const mp4 = await this.fetchQqMvMp4Array(vid)
    if (!mp4) return []
    const out: MvQuality[] = []
    for (const o of mp4) {
      const ft = Number(o?.filetype)
      if (!Number.isFinite(ft)) continue
      if (Number(o?.code ?? 0) !== 0) continue
      const urls = o?.freeflow_url
      if (!Array.isArray(urls) || urls.length === 0) continue
      const name = ftMap.find((m) => m[0] === ft)?.[1]
      if (!name) continue
      const sizeBytes = Number(o?.fileSize ?? 0)
      const displaySize = sizeBytes > 0 ? qqFormatSize(sizeBytes) : ''
      out.push({ quality: String(ft), displayName: name, displaySize })
    }
    return out.sort(
      (a, b) =>
        ftMap.findIndex((m) => String(m[0]) === a.quality) -
        ftMap.findIndex((m) => String(m[0]) === b.quality)
    )
  }

  async getMvUrl(item: MusicItem, quality: string): Promise<MvUrlResult> {
    const vid = item.mvid?.trim()
    if (!vid) return { source: 'qq', playUrl: null, quality, rejectReason: '无 vid' }
    const mp4 = await this.fetchQqMvMp4Array(vid)
    if (!mp4) return { source: 'qq', playUrl: null, quality, rejectReason: '解析响应失败' }
    for (const o of mp4) {
      if (String(o?.filetype) !== quality) continue
      const urls: string[] = Array.isArray(o?.freeflow_url) ? o.freeflow_url : []
      const url = urls.find((u) => u.startsWith('https://')) ?? urls[0]
      if (url) return { source: 'qq', playUrl: url, quality }
    }
    return { source: 'qq', playUrl: null, quality, rejectReason: '未找到清晰度' }
  }

  // —— 按 id/mid 查单曲（歌词重定向对话框用，移植 QQProvider.fromID/fromMid）——
  async fromId(songId: number): Promise<QQMusicItem | null> {
    return this.fetchSongDetail(songId, '')
  }
  async fromMid(mid: string): Promise<QQMusicItem | null> {
    return this.fetchSongDetail(0, mid)
  }
  private async fetchSongDetail(songId: number, songMid: string): Promise<QQMusicItem | null> {
    const req = {
      comm: qqComm('songDetail'),
      req: {
        module: 'music.pf_song_detail_svr',
        method: 'get_song_detail_yqq',
        param: { song_type: 0, song_id: songId, song_mid: songMid }
      }
    }
    const json = await zzcRequest<any>(req).catch(() => null)
    if (!json || json.code !== 0 || json.req?.code !== 0) return null
    const trackInfo = json.req.data?.track_info
    return trackInfo ? parseTrackInfo(trackInfo) : null
  }

  async getLyric(item: MusicItem): Promise<Lyric> {
    if (item.type !== 'qq') return { ...EMPTY_LYRIC }
    // 1) 主路径：musichallSong.PlayLyricInfo（QRC 逐字 + 翻译 + 音译）
    const primary = await this.fetchQqLyric(item.id).catch(() => null)
    if (primary && !isLyricEmpty(primary)) return primary
    // 2) 旧接口回退：fcg_query_lyric_new.fcg（base64 lyric/trans）
    const legacy = await this.fetchLegacyLyric(item.mid).catch(() => null)
    if (legacy && !isLyricEmpty(legacy)) return legacy
    return { ...EMPTY_LYRIC }
  }

  private async fetchQqLyric(songId: number): Promise<Lyric> {
    const req = {
      comm: qqComm('lyric', this.credentials),
      req: {
        method: 'GetPlayLyricInfo',
        module: 'music.musichallSong.PlayLyricInfo',
        param: {
          format: 'json',
          crypt: 1,
          ct: 19,
          cv: 1873,
          interval: 0,
          lrc_t: 0,
          qrc: 1,
          qrc_t: 0,
          roma: 1,
          roma_t: 0,
          songID: songId,
          trans: 1,
          trans_t: 0,
          type: -1
        }
      }
    }
    const json = await zzcRequest<any>(req).catch(() => null)
    if (!json || json.code !== 0 || json.req?.code !== 0) return { ...EMPTY_LYRIC }
    const data = json.req.data
    if (!data) return { ...EMPTY_LYRIC }
    return parseTxLyric(data.lyric, data.trans, data.roma)
  }

  private async fetchLegacyLyric(mid: string): Promise<Lyric> {
    if (!mid) return { ...EMPTY_LYRIC }
    const url =
      'https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg' +
      `?songmid=${mid}&g_tk=5381&loginUin=0&hostUin=0&format=json&inCharset=utf8&outCharset=utf-8&platform=yqq`
    const json = await requestJson<any>(url, {
      headers: { Referer: 'https://y.qq.com/portal/player.html' }
    }).catch(() => null)
    if (!json || json.code !== 0) return { ...EMPTY_LYRIC }
    const lrc = decodeLegacyLyric(json.lyric)
    const trans = decodeLegacyLyric(json.trans)
    if (!lrc && !trans) return { ...EMPTY_LYRIC }
    return { ...EMPTY_LYRIC, lrc, trans }
  }

  // —— 私有 ——
  private async fetchAlbumPayload(albumMid: string): Promise<any | null> {
    const req = {
      comm: qqComm('wkAlbum', this.credentials),
      req_1: {
        module: 'music.musichallAlbum.AlbumInfoServer',
        method: 'GetAlbumDetail',
        param: { albumMid }
      },
      req_2: {
        module: 'music.musichallAlbum.AlbumSongList',
        method: 'GetAlbumSongList',
        param: { albumMid, begin: 0, num: 1000, order: 2 }
      }
    }
    return zzcRequest<any>(req).catch(() => null)
  }

  private parseAlbumEntry(o: any): AlbumInfoResult | null {
    const mid = o.albumMID
    if (!mid) return null
    return {
      source: 'qq',
      id: mid,
      name: stripEm(o.albumName ?? ''),
      cover: o.albumPic ?? `https://y.gtimg.cn/music/photo_new/T002R800x800M000${mid}.jpg`,
      artist: o.singerName,
      publishTime:
        o.publicTime && !String(o.publicTime).startsWith('0000') ? String(o.publicTime) : undefined,
      total: num(o.song_count, 0)
    }
  }

  private parseSingerEntry(o: any): ArtistInfoResult | null {
    const mid = o.singerMID
    if (!mid) return null
    return {
      source: 'qq',
      id: mid,
      name: stripEm(o.singerName ?? ''),
      cover: o.singerPic,
      albumCount: num(o.albumNum, 0),
      songCount: num(o.songNum, 0)
    }
  }

  private extractDissId(input: string): string | null {
    const t = input.trim()
    if (/^\d+$/.test(t)) return t
    for (const re of [/[?&]id=(\d+)/, /\/playlist\/(\d+)/, /disstid=(\d+)/]) {
      const m = re.exec(t)
      if (m) return m[1]
    }
    return null
  }

  // —— 评论 ——
  supportsComment(): boolean {
    return true
  }
  async getComment(item: MusicItem, page = 1, limit = 20): Promise<CommentResult> {
    return qqGetComment(item, page, limit)
  }
  async getHotComment(item: MusicItem, page = 1, limit = 20): Promise<CommentResult> {
    return qqGetHotComment(item, page, limit)
  }
}
