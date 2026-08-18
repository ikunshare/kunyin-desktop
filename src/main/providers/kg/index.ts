/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 酷狗音乐 Provider（移植自 KgProvider.kt）。
 * 公开接口用 kgSign 签名；search 无签名。播放走后端 getUrl（platform=kugou, musicId=hash 小写）。
 * 登录链（歌单/用户）依赖 native KgCrypto，暂缓。歌词见 lyric.ts（Task 19）。
 */
import { createHash } from 'node:crypto'
import {
  type AlbumInfoResult,
  type AlbumSearchResult,
  type ArtistInfoResult,
  type ArtistMvItem,
  type ArtistMvResult,
  type ArtistSearchResult,
  type KugouMusicItem,
  type Lyric,
  type MusicItem,
  type MusicListResult,
  type MvQuality,
  type MvUrlResult
} from '@common'
import { BaseProvider } from '../base'
import { requestJson } from '../../net/request'
import { kgSign, nowSec, signedQuery } from './sign'
import { cleanText, num, parseKgAlbumSong, parseKgAuthorSong, parseSearchItem } from './item'
import { getKgLyric } from './lyric'

/** MV 接口的固定设备指纹（移植自 KgProvider，仅上报用） */
const KG_MV_MID = '77752093425314814852697061885572080940'
const KG_MV_DFID = '08TyVG0PFspm0LUMKk2uOiI1'
const KG_MV_UUID = '6d107aa2f28fa7dbef52d223156d79a1'

function md5Hex(text: string): string {
  return createHash('md5').update(text, 'utf-8').digest('hex')
}

/** 字节 → MB/GB 显示（MV 音质档用）。 */
function kgFormatSize(bytes: number): string {
  const mb = bytes / 1024 / 1024
  return mb >= 1024 ? `${(mb / 1024).toFixed(2)}GB` : `${mb.toFixed(1)}MB`
}

/** 清洗发行日期：`0000-…` 占位与空值归一为 undefined；数字时间戳原样透出（年份由 publishYear 解析）。 */
function kgDate(raw: unknown): string | undefined {
  if (typeof raw === 'number') return raw > 0 ? String(raw) : undefined
  const s = typeof raw === 'string' ? raw.trim() : ''
  if (!s || s.startsWith('0000')) return undefined
  return /^\d+$/.test(s) ? s : s.slice(0, 10)
}

export class KgProvider extends BaseProvider {
  readonly source = 'kg' as const
  readonly displayName = '酷狗音乐'

  async getLyric(item: MusicItem): Promise<Lyric> {
    return getKgLyric(item as KugouMusicItem)
  }

  async search(keyword: string, page = 0, size = 20): Promise<MusicListResult> {
    const kw = encodeURIComponent(keyword).replace(/%20/g, '+')
    const url =
      `http://songsearch.kugou.com/song_search_v2?platform=AndroidFilter&iscorrection=1` +
      `&keyword=${kw}&hifiquality=0&pagesize=${size}&PrivilegeFilter=0&page=${page + 1}`
    const json = await requestJson<any>(url).catch(() => null)
    if (!json) return this.emptyList(page, size)
    const total = num(json.data?.total, 0)
    const items = (json.data?.lists ?? [])
      .map((x: any) => parseSearchItem(x))
      .filter((x: any): x is KugouMusicItem => !!x)
    await this.fetchCovers(items)
    return { source: 'kg', hasNext: (page + 1) * size < total, page, size, result: items }
  }

  async getHotSearch(): Promise<string[]> {
    const url =
      'http://msearch.kugou.com/api/v3/search/hot_tab?signature=ee44edb9d7155821412d220bcaf509dd&appid=1005&clientver=10026&plat=0'
    const json = await requestJson<any>(url, {
      headers: {
        dfid: '1sLbSM0a4sRs09lSwl4Kmbi6',
        mid: '156798703528610303010610',
        clienttime: String(Date.now()),
        userid: '0'
      }
    }).catch(() => null)
    if (!json) return []
    const out: string[] = []
    for (const g of json.data?.list ?? []) {
      for (const k of g.keywords ?? []) if (k?.keyword) out.push(k.keyword)
    }
    return out
  }

  async getSearchTip(keyword: string): Promise<string[]> {
    const url = `https://searchtip.kugou.com/getSearchTip?MusicTipCount=10&keyword=${encodeURIComponent(keyword)}`
    const json = await requestJson<any>(url, {
      headers: { referer: 'https://www.kugou.com/' }
    }).catch(() => null)
    if (!json) return []
    return (json.data?.[0]?.RecordDatas ?? [])
      .map((r: any) => r?.HintInfo)
      .filter((x: any): x is string => !!x)
  }

  async searchAlbum(keyword: string, page = 0, size = 20): Promise<AlbumSearchResult> {
    const params = {
      appid: '1005',
      category: '1',
      clienttime: nowSec(),
      clientver: '20669',
      current_mixsongid: '0',
      dfid: '-',
      iscorrection: '1',
      keyword,
      mid: '-',
      page: String(page + 1),
      pagesize: String(size),
      platform: 'AndroidFilter',
      requestid: '-',
      search_source: '手动输入',
      searchsong: '0',
      sorttype: '0',
      tag: 'em',
      token: '',
      userid: '0',
      uuid: '-'
    }
    const json = await requestJson<any>(
      `https://complexsearch.kugou.com/v1/search/album?${signedQuery(params)}`
    ).catch(() => null)
    if (!json) return this.emptyPage(page, size)
    const total = num(json.data?.total, 0)
    const result = (json.data?.lists ?? [])
      .map((a: any) => this.parseAlbumEntry(a))
      .filter((x: any): x is AlbumInfoResult => !!x)
    return { source: 'kg', hasNext: (page + 1) * size < total, page, size, result }
  }

  async searchArtist(keyword: string, page = 0, size = 20): Promise<ArtistSearchResult> {
    const params = {
      appid: '1005',
      clienttime: nowSec(),
      clientver: '20669',
      current_mixsongid: '0',
      dfid: '-',
      iscorrection: '1',
      keyword,
      mid: '-',
      page: String(page + 1),
      pagesize: String(size),
      platform: 'AndroidFilter',
      requestid: '-',
      search_source: '手动输入',
      tag: 'em',
      token: '',
      userid: '0',
      uuid: '-'
    }
    const json = await requestJson<any>(
      `https://complexsearch.kugou.com/v1/search/author?${signedQuery(params)}`
    ).catch(() => null)
    if (!json || json.status !== 1) return this.emptyPage(page, size)
    const total = num(json.data?.total, 0)
    const result = (json.data?.lists ?? [])
      .map((a: any) => this.parseArtistEntry(a))
      .filter((x: any): x is ArtistInfoResult => !!x)
    return { source: 'kg', hasNext: (page + 1) * size < total, page, size, result }
  }

  async getAlbumSongs(albumId: string): Promise<MusicListResult> {
    const data = await this.fetchKgAlbumPayload(albumId)
    if (!data) return this.emptyList()
    const items = (data.song_data?.song_list ?? [])
      .map((s: any) => parseKgAlbumSong(s))
      .filter((x: any): x is KugouMusicItem => !!x)
    return { source: 'kg', hasNext: false, page: 0, size: items.length, result: items }
  }

  async getAlbumInfo(albumId: string): Promise<AlbumInfoResult | null> {
    const data = await this.fetchKgAlbumPayload(albumId)
    const ai = data?.album_info
    if (!ai?.album_name) return null
    return {
      source: 'kg',
      id: String(albumId),
      name: ai.album_name,
      cover: ai.sizable_cover ? String(ai.sizable_cover).replace('{size}', '480') : undefined,
      artist: ai.author_name,
      publishTime: kgDate(ai.publish_date),
      description: ai.intro ?? ai.short_intro_v2,
      total: num(data.song_data?.total, 0)
    }
  }

  async getArtistSongs(artistId: string, page = 0, size = 30): Promise<MusicListResult> {
    const data = await this.fetchKgAuthorPayload(artistId, page, size)
    if (!data) return this.emptyList(page, size)
    const total = num(data.total, 0)
    const items = (data.songs ?? [])
      .map((s: any) => parseKgAuthorSong(s))
      .filter((x: any): x is KugouMusicItem => !!x)
    return { source: 'kg', hasNext: (page + 1) * size < total, page, size, result: items }
  }

  async getArtistInfo(artistId: string): Promise<ArtistInfoResult | null> {
    const data = await this.fetchKgAuthorPayload(artistId, 0, 1)
    const info = data?.author_info
    const name = info?.singer_info?.singername ?? info?.base?.author_name
    if (!name) return null
    const avatarSrc = info.base?.avatar ?? info.singer_info?.imgurl
    return {
      source: 'kg',
      id: String(artistId),
      name,
      cover: avatarSrc ? String(avatarSrc).replace('{size}', '480') : undefined,
      description: info.singer_info?.intro ?? info.singer_info?.profile,
      songCount: num(info.singer_info?.songcount ?? data.total, 0),
      albumCount: num(info.singer_info?.albumcount, 0)
    }
  }

  supportsArtistAlbums(): boolean {
    return true
  }
  supportsArtistMvs(): boolean {
    return true
  }

  async getArtistAlbums(artistId: string, page = 0, size = 30): Promise<AlbumSearchResult> {
    const params = {
      appid: '1005',
      area_code: '1',
      category: '1',
      clienttime: nowSec(),
      clientver: '20669',
      dfid: '-',
      mid: '-',
      page: String(page + 1),
      pagesize: String(size),
      plat: '1',
      show_album_tag: '0',
      singerid: String(artistId),
      token: '',
      userid: '0',
      uuid: '-',
      version: '20669'
    }
    const json = await requestJson<any>(
      `https://gateway.kugou.com/ocean/v6/singer/album?${signedQuery(params)}`
    ).catch(() => null)
    if (!json || json.status !== 1) return this.emptyPage(page, size)
    const total = num(json.data?.total, 0)
    const result: AlbumInfoResult[] = []
    for (const o of json.data?.info ?? []) {
      const albumId = num(o?.albumid, 0)
      if (!albumId || !o?.albumname) continue
      result.push({
        source: 'kg',
        id: String(albumId),
        name: cleanText(o.albumname),
        cover: o.imgurl ? String(o.imgurl).replace('{size}', '480') : undefined,
        artist: o.singername ? cleanText(o.singername) : undefined,
        artistId: o.singerid != null ? String(o.singerid) : undefined,
        publishTime: kgDate(o.publishtime),
        total: num(o.songcount, 0)
      })
    }
    return { source: 'kg', hasNext: (page + 1) * size < total, page, size, result }
  }

  async getArtistMvs(artistId: string, page = 0, size = 40): Promise<ArtistMvResult> {
    const params = {
      appid: '1005',
      author_id: String(artistId),
      clienttime: nowSec(),
      clientver: '20669',
      dfid: '-',
      mid: '-',
      page: String(page + 1),
      pagesize: String(size),
      tag_idx: '',
      uuid: '-'
    }
    const json = await requestJson<any>(
      `https://openapicdnretry.kugou.com/kmr/v1/author/videos?${signedQuery(params)}`
    ).catch(() => null)
    if (!json || json.status !== 1) {
      return { source: 'kg', hasNext: false, page, size, total: 0, result: [] }
    }
    const total = num(json.total, 0)
    const result: ArtistMvItem[] = []
    for (const o of json.data ?? []) {
      const vid = o?.video_id != null ? String(o.video_id).trim() : ''
      if (!vid || vid === '0') continue
      result.push({
        source: 'kg',
        vid,
        title: o.video_name ?? '',
        cover: o.hdpic ? String(o.hdpic).replace('{size}', '480') : '',
        duration: num(o.timelength, 0),
        playCount: num(o.history_heat, 0),
        pubTime: Date.parse(String(o.publish_date ?? '').slice(0, 10)) || 0
      })
    }
    return { source: 'kg', hasNext: (page + 1) * size < total, page, size, total, result }
  }

  createMvItem(vid: string, title: string, cover: string): MusicItem {
    return {
      type: 'kg',
      id: 0,
      title,
      artist: '',
      album: '',
      cover,
      duration: 0,
      qualities: { '128k': { id: '128k', name: '普通音质 128K', filesize: 0, bitrate: 128 } },
      hash: '',
      mvid: vid
    }
  }

  // —— MV ——（移植 KgProvider.getMvQualities/getMvUrl：union_mv_play 取 h265 各档 hash）
  /** 拉 MV 各清晰度的 hash/filesize（h265 节点）；失败返回 null。 */
  private async fetchMvInfo(videoId: string): Promise<any | null> {
    const time = nowSec()
    const body = `{"data":[{"video_id":${JSON.stringify(videoId)}}]}`
    const params = {
      appid: '1005',
      clienttime: time,
      clientver: '20609',
      dfid: KG_MV_DFID,
      mid: KG_MV_MID,
      token: '',
      userid: '0',
      uuid: KG_MV_UUID
    }
    // 该接口的 signature 把 POST body 也计入摘要，故不能走 signedQuery
    const signature = kgSign(params, body)
    const url =
      `https://gateway.kugou.com/openapi/v1/unique/union_mv_play?` +
      `clientver=20609&userid=0&mid=${KG_MV_MID}&dfid=${KG_MV_DFID}&uuid=${KG_MV_UUID}` +
      `&appid=1005&token=&signature=${signature}&clienttime=${time}`
    const json = await requestJson<any>(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body
    }).catch(() => null)
    return json?.data?.[0]?.mv_info?.h265 ?? null
  }

  async getMvQualities(item: MusicItem): Promise<MvQuality[]> {
    const videoId = item.mvid?.trim()
    if (!videoId) return []
    const info = await this.fetchMvInfo(videoId)
    if (!info) return []
    // quality 直接用该档的 hash（getMvUrl 据此取流）
    const tiers: [string, string][] = [
      ['fhd', '蓝光画质'],
      ['hd', '超清画质'],
      ['qhd', '高清画质'],
      ['sd', '标清画质']
    ]
    const out: MvQuality[] = []
    for (const [prefix, displayName] of tiers) {
      const hash = typeof info[`${prefix}_hash`] === 'string' ? info[`${prefix}_hash`].trim() : ''
      const size = num(info[`${prefix}_filesize`], 0)
      if (!hash || size <= 0) continue
      out.push({ quality: hash, displayName, displaySize: kgFormatSize(size) })
    }
    return out
  }

  async getMvUrl(item: MusicItem, quality: string): Promise<MvUrlResult> {
    const videoId = item.mvid?.trim()
    if (!videoId) return { source: 'kg', playUrl: null, quality, rejectReason: '无 mvid' }
    const hash = quality.toLowerCase()
    const key = md5Hex(`${hash}kugoumvcloud`)
    const time = nowSec()
    const params = {
      appid: '1005',
      backupdomain: '1',
      clienttime: time,
      clientver: '20609',
      cmd: '123',
      dfid: KG_MV_DFID,
      ext: 'mp4',
      hash,
      key,
      mid: KG_MV_MID,
      pid: '2',
      token: '',
      userid: '0',
      uuid: '-',
      video_id: videoId
    }
    const signature = kgSign(params)
    const url =
      `https://trackermv.kugou.com/interface/index?clientver=20609&userid=0&cmd=123&ext=mp4` +
      `&key=${key}&mid=${KG_MV_MID}&pid=2&dfid=${KG_MV_DFID}&hash=${hash}&uuid=-` +
      `&appid=1005&token=&backupdomain=1&signature=${signature}&clienttime=${time}` +
      `&video_id=${videoId}`
    const json = await requestJson<any>(url).catch(() => null)
    const downUrl = json?.data?.[hash]?.downurl
    if (typeof downUrl === 'string' && downUrl) return { source: 'kg', playUrl: downUrl, quality }
    return { source: 'kg', playUrl: null, quality, rejectReason: '无下载链接' }
  }

  // —— 私有 ——
  private parseAlbumEntry(o: any): AlbumInfoResult | null {
    if (!o.albumid) return null
    return {
      source: 'kg',
      id: String(o.albumid),
      name: cleanText(o.albumname ?? ''),
      cover: o.img,
      artist: cleanText(o.singer ?? ''),
      publishTime:
        o.publish_time && !String(o.publish_time).startsWith('0000')
          ? String(o.publish_time)
          : undefined,
      description: o.intro,
      total: num(o.songcount, 0)
    }
  }

  private parseArtistEntry(o: any): ArtistInfoResult | null {
    if (num(o.AuthorId, 0) <= 0) return null
    return {
      source: 'kg',
      id: String(o.AuthorId),
      name: cleanText(o.AuthorName ?? ''),
      cover: o.Avatar ? String(o.Avatar).replace('{size}', '240') : undefined,
      songCount: num(o.AudioCount, 0),
      albumCount: num(o.AlbumCount, 0)
    }
  }

  private async fetchKgAlbumPayload(albumId: string): Promise<any | null> {
    const params = {
      album_id: String(albumId),
      appid: '1005',
      area_code: '1',
      clienttime: nowSec(),
      clientver: '20669',
      dfid: '-',
      is_buy: '0',
      mid: '-',
      page: '1',
      pagesize: '50',
      show_album_audios_timelength: '1',
      show_album_info: '1',
      show_album_tags: '1',
      show_awards: '1',
      show_classical_author: '1',
      show_dycover: '1',
      show_short_intro_v2: '1',
      userid: '0'
    }
    const json = await requestJson<any>(
      `https://openapi.kugou.com/v1/union/album/audios?${signedQuery(params)}`
    ).catch(() => null)
    return json && json.status === 1 ? json.data : null
  }

  private async fetchKgAuthorPayload(
    authorId: string,
    page: number,
    pagesize: number
  ): Promise<any | null> {
    const params = {
      album_audio_id: '0',
      appid: '1005',
      area_code: '1',
      author_id: String(authorId),
      clienttime: nowSec(),
      clientver: '20669',
      dfid: '-',
      mid: '-',
      mvdata_need: '1',
      need_song_list: '1',
      page: String(page + 1),
      pagesize: String(pagesize),
      replace_api_version: '1',
      replace_need: '1',
      show_audio_tag: '1',
      sort: '1',
      uuid: '-'
    }
    const json = await requestJson<any>(
      `https://gateway.kugou.com/openapi/v2/union/author/audios?${signedQuery(params)}`
    ).catch(() => null)
    return json && json.status === 1 ? json.data : null
  }

  /** 搜索结果无封面，批量从 media.store 补 */
  private async fetchCovers(items: KugouMusicItem[]): Promise<void> {
    if (!items.length) return
    const resource = items.map((it) => ({
      album_audio_id: it.audioId || '0',
      album_id: it.albumId || '',
      hash: it.hash,
      id: 0,
      name: `${it.artist} - ${it.title}.mp3`,
      type: 'audio'
    }))
    const json = await requestJson<any>('http://media.store.kugou.com/v1/get_res_privilege', {
      method: 'POST',
      headers: {
        'KG-RC': '1',
        'KG-THash': 'expand_search_manager.cpp:852736169:451',
        'User-Agent': 'KuGou2012-9020-ExpandSearchManager',
        'Content-Type': 'application/json; charset=utf-8'
      },
      body: {
        appid: 1001,
        area_code: '1',
        behavior: 'play',
        clientver: '9020',
        need_hash_offset: 1,
        relate: 1,
        resource,
        token: '',
        userid: 2626431536,
        vip: 1
      }
    }).catch(() => null)
    if (!json || json.error_code !== 0) return
    const data = json.data ?? []
    data.forEach((d: any, i: number) => {
      const info = d?.info
      if (info?.image && items[i]) {
        const sz = info.imgsize?.[0] ?? 240
        items[i].cover = String(info.image).replace('{size}', String(sz))
      }
    })
  }
}
