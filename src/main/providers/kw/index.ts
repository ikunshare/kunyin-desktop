/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 酷我音乐 Provider（移植自 Android KwProvider.kt）。
 * 除歌词外无签名。search/searchAlbum/searchArtist=JSON；albumSongs/artistSongs=XML。
 * 播放走后端 getUrl（platform=kuwo, musicId=数字 id）。歌词见 lyric.ts（Task 19）。
 */
import { inflateSync } from 'node:zlib'
import {
  type AlbumInfoResult,
  type AlbumSearchResult,
  type ArtistInfoResult,
  type ArtistMvItem,
  type ArtistMvResult,
  type ArtistSearchResult,
  type KuwoMusicItem,
  type Lyric,
  type MusicItem,
  type MusicListResult,
  type MvQuality,
  type MvUrlResult
} from '@common'
import { BaseProvider } from '../base'
import { requestBuffer, requestText } from '../../net/request'
import { num, parseMusicElements, parseMusicPayItem, parseSearchItem, unescapeXml } from './item'
import { getKwLyric } from './lyric'

const UID = '794762570'
const VER = 'kwplayer_ar_9.2.2.1'

/** 酷我 MV 清晰度档位（管道分隔的 mvquality 字段值 → 显示名） */
const KW_MV_TIERS: [string, string][] = [
  ['MP4BD', '蓝光画质'],
  ['MP4UL', '超清画质'],
  ['MP4HV', '高清画质'],
  ['MP4', '标清画质']
]

/** 取 XML 属性（空值视为缺失，与安卓 attr() 一致） */
function attr(xml: string, name: string): string | undefined {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(xml)
  return m?.[1] || undefined
}

/**
 * mobi.s 的 album_list 响应是「文本头 + CRLF + 压缩长度(LE) + 原长(LE) + deflate 数据」，
 * 需手工剥头再 inflate（移植 KwProvider.decodeMobiResponse）。
 */
function decodeMobiResponse(raw: Buffer): string | null {
  if (raw.length < 16) return null
  const crlf = raw.indexOf('\r\n')
  if (crlf < 0) return null
  const headerEnd = crlf + 2
  if (headerEnd + 8 >= raw.length) return null
  const compSize = raw.readInt32LE(headerEnd)
  const decompSize = raw.readInt32LE(headerEnd + 4)
  if (compSize <= 0 || decompSize <= 0) return null
  const payloadStart = headerEnd + 8
  if (payloadStart + compSize > raw.length) return null
  try {
    return inflateSync(raw.subarray(payloadStart, payloadStart + compSize)).toString('utf-8')
  } catch {
    return null
  }
}

/** 清洗发行日期：`0000-…` 占位与空值归一为 undefined。 */
function kwDate(raw: string | undefined): string | undefined {
  const s = raw?.trim()
  return s && !s.startsWith('0000') ? s : undefined
}

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

  /**
   * 酷我无歌手详情接口（安卓同样缺），用搜索兜底：以歌手名精确匹配回填头像/专辑数/简介。
   * 拿不到时返回 null，页面头部退化用搜索结果的预览缓存。
   */
  async getArtistInfo(artistId: string): Promise<ArtistInfoResult | null> {
    const first = (await this.getArtistSongs(artistId, 0, 1)).result[0]
    const name = first?.artist?.split(/[&、,，]/)[0]?.trim()
    if (!name) return null
    const found = await this.searchArtist(name, 0, 20)
    return found.result.find((a) => a.id === String(artistId)) ?? null
  }

  supportsArtistAlbums(): boolean {
    return true
  }
  supportsArtistMvs(): boolean {
    return true
  }

  async getArtistAlbums(artistId: string, page = 0, size = 30): Promise<AlbumSearchResult> {
    const start = page * size
    const url =
      `http://mobi.kuwo.cn/mobi.s?f=web&type=album_list&artist_id=${artistId}&start=${start}` +
      `&count=${size}&uid=${UID}&prod=${VER}&vipver=1&presell=1&hasmv=1&hasinner=1`
    const raw = await requestBuffer(url).catch(() => null)
    const body = raw ? decodeMobiResponse(raw) : null
    if (!body) return this.emptyPage(page, size)
    const total = num(/total="(\d+)"/.exec(body)?.[1], 0)
    const result: AlbumInfoResult[] = []
    for (const m of body.matchAll(/<album\b[^>]*?\/?>/g)) {
      const el = m[0]
      const id = attr(el, 'id')
      const name = attr(el, 'name')
      if (!id || !name) continue
      result.push({
        source: 'kw',
        id,
        name: unescapeXml(name),
        cover: attr(el, 'img'),
        artist: unescapeXml(attr(el, 'artist') ?? '') || undefined,
        artistId: attr(el, 'artistid'),
        publishTime: kwDate(attr(el, 'publish')),
        company: unescapeXml(attr(el, 'company') ?? '') || undefined,
        total: num(attr(el, 'musicnum'), 0)
      })
    }
    return { source: 'kw', hasNext: start + size < total, page, size, result }
  }

  async getArtistMvs(artistId: string, page = 0, size = 40): Promise<ArtistMvResult> {
    const start = page * size
    const url =
      `http://mobi.kuwo.cn/mobi.s?f=web&type=music_list&id=${artistId}&key=mv&start=${start}` +
      `&count=${size}&uid=${UID}&prod=${VER}&vipver=1&presell=1&apiv=2&hasmv=1&hasinner=1`
    const xml = await requestText(url).catch(() => '')
    if (!xml) return { source: 'kw', hasNext: false, page, size, total: 0, result: [] }
    const total = num(/total="(\d+)"/.exec(xml)?.[1], 0)
    const result: ArtistMvItem[] = []
    for (const m of xml.matchAll(/<mv\b[^>]*?\/?>/g)) {
      const el = m[0]
      const rid = attr(el, 'rid')
      // vid 仅用于确认「有 MV」；取流按 rid（酷我 convert_mv_url2 收的是 rid）
      if (!rid || attr(el, 'vid') === '0' || !attr(el, 'vid')) continue
      result.push({
        source: 'kw',
        vid: rid,
        title: unescapeXml(attr(el, 'name') ?? ''),
        cover: attr(el, 'img') ?? '',
        duration: num(attr(el, 'duration'), 0),
        playCount: num(attr(el, 'listencnt'), 0)
      })
    }
    return { source: 'kw', hasNext: start + size < total, page, size, total, result }
  }

  createMvItem(vid: string, title: string, cover: string): MusicItem {
    return {
      type: 'kw',
      id: num(vid, 0),
      title,
      artist: '',
      album: '',
      cover,
      duration: 0,
      qualities: { '128k': { id: '128k', name: '普通音质 128K', filesize: 0, bitrate: 128 } },
      mvid: vid
    }
  }

  // —— MV ——（移植 KwProvider.getMvQualities/getMvUrl）
  async getMvQualities(item: MusicItem): Promise<MvQuality[]> {
    // musicpay 的 mvquality 字段给出可用档位（管道分隔，例 "MP4|MP4HV|MP4UL|MP4BD"）
    const url =
      `https://musicpay.kuwo.cn/music.pay?ver=MUSIC_9.1.1.2_BCS2&src=mbox&op=query&signver=new` +
      `&action=play&ids=${item.id}&accttype=1&appuid=38668888`
    const json = this.parseJson(
      await requestText(url, { headers: { 'User-Agent': 'okhttp/3.10.0' } }).catch(() => '')
    )
    const raw = json?.songs?.[0]?.mvquality
    const supported = new Set(
      typeof raw === 'string' ? raw.split('|').filter((s: string) => s.trim()) : []
    )
    return KW_MV_TIERS.filter(([q]) =>
      // 兜底：mvquality 缺失时只试 MP4HV（与安卓一致）
      supported.size ? supported.has(q) : q === 'MP4HV'
    ).map(([quality, displayName]) => ({ quality, displayName }))
  }

  async getMvUrl(item: MusicItem, quality: string): Promise<MvUrlResult> {
    const url =
      `http://anymatch.kuwo.cn/mobi.s?f=web&user=0&prod=kwplayer_ar_12.1.0.1&corp=kuwo` +
      `&type=convert_mv_url2&rid=${item.id}&format=mp4&quality=${quality}`
    const body = await requestText(url, {
      headers: { 'User-Agent': 'okhttp/3.10.0' }
    }).catch(() => '')
    if (!body) return { source: 'kw', playUrl: null, quality, rejectReason: '空响应' }
    if (body.startsWith('DC ') || body.includes('data error')) {
      return { source: 'kw', playUrl: null, quality, rejectReason: '无效 vid' }
    }
    // 文本格式：key=value 多行，含 url= / bitrate=（bitrate<=1 视为占位失败）
    const playUrl = /(?:^|\n)url=([^\n\r]+)/.exec(body)?.[1]?.trim()
    const bitrate = num(/(?:^|\n)bitrate=(\d+)/.exec(body)?.[1], 0)
    if (!playUrl || bitrate <= 1) {
      return { source: 'kw', playUrl: null, quality, rejectReason: '返回无效' }
    }
    return { source: 'kw', playUrl, quality }
  }

  private parseAlbumEntry(o: any): AlbumInfoResult | null {
    const id = o.albumid || o.id
    if (!id || !o.name) return null
    return {
      source: 'kw',
      id: String(id),
      name: o.name,
      // img 是 HTTP sycdn 地址；优先使用接口同时返回的可用 HTTPS 地址
      cover: o.hts_img ?? o.img,
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
