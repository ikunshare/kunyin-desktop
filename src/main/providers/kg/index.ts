/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 酷狗音乐 Provider（移植自 KgProvider.kt）。
 * 公开接口用 kgSign 签名；search 无签名。播放走后端 getUrl（platform=kugou, musicId=hash 小写）。
 * 登录链（歌单/用户）依赖 native KgCrypto，暂缓。歌词见 lyric.ts（Task 19）。
 */
import {
  type AlbumInfoResult,
  type AlbumSearchResult,
  type ArtistInfoResult,
  type ArtistSearchResult,
  type KugouMusicItem,
  type Lyric,
  type MusicItem,
  type MusicListResult
} from '@common'
import { BaseProvider } from '../base'
import { requestJson } from '../../net/request'
import { nowSec, signedQuery } from './sign'
import { cleanText, num, parseKgAlbumSong, parseKgAuthorSong, parseSearchItem } from './item'
import { getKgLyric } from './lyric'

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
      publishTime: ai.publish_date,
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
