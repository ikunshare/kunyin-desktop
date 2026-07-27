/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 酷我音乐 Provider（移植自 Android KwProvider.kt）。
 * 除歌词外无签名。search/searchAlbum/searchArtist=JSON；albumSongs/artistSongs=XML。
 * 播放走后端 getUrl（platform=kuwo, musicId=数字 id）。歌词见 lyric.ts（Task 19）。
 */
import {
  type AlbumInfoResult,
  type AlbumSearchResult,
  type ArtistInfoResult,
  type ArtistSearchResult,
  type KuwoMusicItem,
  type Lyric,
  type MusicItem,
  type MusicListResult
} from '@common'
import { BaseProvider } from '../base'
import { requestText } from '../../net/request'
import { num, parseMusicElements, parseMusicPayItem, parseSearchItem } from './item'
import { getKwLyric } from './lyric'

const UID = '794762570'
const VER = 'kwplayer_ar_9.2.2.1'

export class KwProvider extends BaseProvider {
  readonly source = 'kw' as const
  readonly displayName = '酷我音乐'

  private parseJson(body: string): any {
    try {
      return JSON.parse(body)
    } catch {
      return null
    }
  }

  async getLyric(item: MusicItem): Promise<Lyric> {
    return getKwLyric(item.id)
  }

  async search(keyword: string, page = 0, size = 20): Promise<MusicListResult> {
    const url =
      `http://search.kuwo.cn/r.s?client=kt&all=${encodeURIComponent(keyword)}&pn=${page}&rn=${size}` +
      `&uid=${UID}&ver=${VER}&vipver=1&show_copyright_off=1&newver=1&ft=music&cluster=0` +
      `&strategy=2012&encoding=utf8&rformat=json&vermerge=1&mobi=1&issubtitle=1`
    const json = this.parseJson(await requestText(url).catch(() => ''))
    if (!json) return this.emptyList(page, size)
    const total = num(json.TOTAL, 0)
    if (total !== 0 && num(json.SHOW, 0) === 0) return this.emptyList(page, size) // 风控
    const items = (json.abslist ?? [])
      .map((x: any) => parseSearchItem(x))
      .filter((x: any): x is KuwoMusicItem => !!x)
    await this.fetchCovers(items)
    return { source: 'kw', hasNext: (page + 1) * size < total, page, size, result: items }
  }

  async getHotSearch(): Promise<string[]> {
    const text = await requestText(
      'http://hotword.kuwo.cn/hotword.s?prod=kwplayer_ar_9.3.1.3&corp=kuwo&newver=2&vipver=1&colorid=6&encoding=utf8'
    ).catch(() => '')
    if (!text) return []
    const json = this.parseJson(text)
    if (json && Array.isArray(json.tagvalue)) {
      return json.tagvalue.map((t: any) => t?.key).filter((x: any): x is string => !!x)
    }
    return text
      .split('\n')
      .map((l) => l.replace(/^TEXT=/, '').trim())
      .filter((l) => l)
  }

  async searchAlbum(keyword: string, page = 0, size = 20): Promise<AlbumSearchResult> {
    const url =
      `http://search.kuwo.cn/r.s?client=kt&all=${encodeURIComponent(keyword)}&pn=${page}&rn=${size}` +
      `&uid=${UID}&ver=${VER}&vipver=1&show_copyright_off=1&newver=3&ft=album&albumver=1` +
      `&cluster=0&strategy=2012&encoding=utf8&rformat=json&mobi=1&correct=1`
    const json = this.parseJson(await requestText(url).catch(() => ''))
    if (!json) return this.emptyPage(page, size)
    const total = num(json.total, 0)
    const result = (json.albumlist ?? [])
      .map((a: any) => this.parseAlbumEntry(a))
      .filter((x: any): x is AlbumInfoResult => !!x)
    return { source: 'kw', hasNext: (page + 1) * size < total, page, size, result }
  }

  async searchArtist(keyword: string, page = 0, size = 20): Promise<ArtistSearchResult> {
    const url =
      `http://search.kuwo.cn/r.s?client=kt&all=${encodeURIComponent(keyword)}&pn=${page}&rn=${size}` +
      `&uid=${UID}&ver=${VER}&vipver=1&show_copyright_off=0&newver=3&ft=artist&cluster=0` +
      `&encoding=utf8&rformat=json&mobi=1`
    const json = this.parseJson(await requestText(url).catch(() => ''))
    if (!json) return this.emptyPage(page, size)
    const total = num(json.TOTAL, num(json.HIT, 0))
    const result = (json.abslist ?? [])
      .map((a: any) => this.parseArtistEntry(a))
      .filter((x: any): x is ArtistInfoResult => !!x)
    return { source: 'kw', hasNext: (page + 1) * size < total, page, size, result }
  }

  async getAlbumSongs(albumId: string): Promise<MusicListResult> {
    const url =
      `http://searchlist.kuwo.cn/r.s?f=web&prod=${VER}&corp=kuwo&newver=3&vipver=1&type=music_list` +
      `&id=${albumId}&key=album&apiv=2&order=5&epaor=1&start=0&count=200&hasmv=1&hasinner=1&p2p=1`
    const items = parseMusicElements(await requestText(url).catch(() => ''))
    await this.fetchCovers(items)
    return { source: 'kw', hasNext: false, page: 0, size: items.length, result: items }
  }

  async getAlbumInfo(albumId: string): Promise<AlbumInfoResult | null> {
    const songs = await this.getAlbumSongs(albumId)
    const first = songs.result[0] as KuwoMusicItem | undefined
    if (!first) return null
    return {
      source: 'kw',
      id: albumId,
      name: first.album,
      cover: first.cover,
      artist: first.artist,
      total: songs.result.length
    }
  }

  async getArtistSongs(artistId: string, page = 0, size = 30): Promise<MusicListResult> {
    const start = page * size
    const url =
      `http://mobi.kuwo.cn/mobi.s?f=web&type=music_list&id=${artistId}&key=artist&start=${start}` +
      `&count=${size}&uid=${UID}&prod=${VER}&vipver=1&presell=1&apiv=2&epaor=1&hasmv=1&hasinner=1`
    const xml = await requestText(url).catch(() => '')
    const total = num(/total="(\d+)"/.exec(xml)?.[1], 0)
    const items = parseMusicElements(xml)
    // 源码歌手歌曲不调 fetchCovers（封面取 XML 的 img）；仅专辑歌曲才补 500x500
    return { source: 'kw', hasNext: start + size < total, page, size, result: items }
  }

  private parseAlbumEntry(o: any): AlbumInfoResult | null {
    const id = o.albumid || o.id
    if (!id || !o.name) return null
    return {
      source: 'kw',
      id: String(id),
      name: o.name,
      cover: o.img ?? o.hts_img,
      artist: o.artist,
      publishTime: o.pub && !String(o.pub).startsWith('0000') ? String(o.pub) : undefined,
      description: o.info,
      total: num(o.musiccnt, 0)
    }
  }

  private parseArtistEntry(o: any): ArtistInfoResult | null {
    if (!o.ARTISTID || !o.ARTIST) return null
    return {
      source: 'kw',
      id: String(o.ARTISTID),
      name: o.ARTIST,
      cover: o.hts_PICPATH,
      description: o.desc,
      songCount: num(o.SONGNUM, 0),
      albumCount: num(o.ALBUMNUM, 0)
    }
  }

  /** 按 id 查单曲（歌词重定向对话框用，移植 KwProvider.fromID：musicpay query） */
  async fromId(id: number): Promise<KuwoMusicItem | null> {
    const url =
      `https://musicpay.kuwo.cn/music.pay?ver=MUSIC_9.1.1.2_BCS2&src=mbox&op=query&signver=new` +
      `&action=play&ids=${id}&accttype=1&appuid=38668888`
    const json = this.parseJson(
      await requestText(url, { headers: { 'User-Agent': 'okhttp/3.10.0' } }).catch(() => '')
    )
    const s = json?.songs?.[0]
    return s ? parseMusicPayItem(s) : null
  }

  /** 搜索/专辑/歌手歌曲无封面，批量从 musicpay 补 500x500 */
  private async fetchCovers(items: KuwoMusicItem[]): Promise<void> {
    if (!items.length) return
    const ids = items.map((i) => i.id).join(',')
    const url =
      `https://musicpay.kuwo.cn/music.pay?ver=MUSIC_9.1.1.2_BCS2&src=mbox&op=query&signver=new` +
      `&action=play&ids=${ids}&accttype=1&appuid=38668888`
    const json = this.parseJson(
      await requestText(url, { headers: { 'User-Agent': 'okhttp/3.10.0' } }).catch(() => '')
    )
    if (!json) return
    const map = new Map<number, string>()
    for (const s of json.songs ?? []) {
      if (s.albumPic) {
        map.set(num(s.id, 0), String(s.albumPic).replace('albumcover/120', 'albumcover/500'))
      }
    }
    for (const it of items) {
      const c = map.get(it.id)
      if (c) it.cover = c
    }
  }
}
