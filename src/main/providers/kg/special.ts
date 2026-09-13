/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 酷狗公开歌单（specialid，移植自 LX kg/songList.js）：
 * 网页 `yueku/v9/special/single/{id}-5-9999.html` 里抓 `global.data = [...]` 得到 hash 列表，
 * 再走 gateway `v2/album_audio/audio` 每 100 条批量补齐曲目信息。
 *
 * 发现页给出的歌单 id 形如 `id_123456`，与登录态「我的歌单」的 playlist_id 区分开。
 */
import type { KugouMusicItem } from '@common'
import { requestJson, requestText } from '../../net/request'
import { parseKgAudioInfo } from './item'

export interface KgSpecial {
  id: string
  name: string
  cover?: string
  description?: string
  hashes: string[]
}

const SPECIAL_RE = /^id_(\d+)$/
const SPECIAL_URL_RE = /special\/single\/(\d+)\.html/
const LIST_DATA_RE = /global\.data = (\[.+\]);/
const LIST_INFO_RE = /global = {[\s\S]+?name: "(.+)"[\s\S]+?pic: "(.+)"[\s\S]+?};/
const DESC_PREFIX = '<div class="pc_specail_text pc_singer_tab_content" id="specailIntroduceWrap">'

/** 从 `id_123` / 歌单网页链接 / 纯数字里解析 specialid；非公开歌单形态返回 null */
export function parseKgSpecialId(input: string): string | null {
  const s = String(input ?? '').trim()
  const m = SPECIAL_RE.exec(s) ?? SPECIAL_URL_RE.exec(s)
  if (m) return m[1]
  return /^\d+$/.test(s) ? s : null
}

export function isKgSpecialRef(input: string): boolean {
  const s = String(input ?? '').trim()
  return SPECIAL_RE.test(s) || SPECIAL_URL_RE.test(s)
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .trim()
}

const cache = new Map<string, { at: number; value: KgSpecial }>()
const TTL = 5 * 60 * 1000

export async function fetchKgSpecial(specialId: string): Promise<KgSpecial | null> {
  const hit = cache.get(specialId)
  if (hit && Date.now() - hit.at < TTL) return hit.value
  let html = ''
  for (let i = 0; i < 3 && !html; i++) {
    html = await requestText(
      `http://www2.kugou.kugou.com/yueku/v9/special/single/${specialId}-5-9999.html`
    ).catch(() => '')
    if (html && !LIST_DATA_RE.test(html)) html = ''
  }
  if (!html) return null
  let hashes: string[] = []
  try {
    const raw = JSON.parse(LIST_DATA_RE.exec(html)![1]) as any[]
    hashes = [...new Set(raw.map((x) => String(x?.hash ?? '')).filter(Boolean))]
  } catch {
    return null
  }
  const info = LIST_INFO_RE.exec(html)
  let description: string | undefined
  const at = html.indexOf(DESC_PREFIX)
  if (at >= 0) {
    const rest = html.slice(at + DESC_PREFIX.length)
    const end = rest.indexOf('</div>')
    if (end >= 0) description = decodeEntities(rest.slice(0, end)) || undefined
  }
  const value: KgSpecial = {
    id: specialId,
    name: info ? decodeEntities(info[1]) : `歌单 ${specialId}`,
    cover: info?.[2] ? String(info[2]).replace('{size}', '480') : undefined,
    description,
    hashes
  }
  cache.set(specialId, { at: Date.now(), value })
  return value
}

/** gateway 批量曲目详情（每批 ≤100）；顺序与传入 hash 一致，失败批次跳过 */
export async function fetchKgAudioInfos(hashes: string[]): Promise<KugouMusicItem[]> {
  const out: KugouMusicItem[] = []
  const seen = new Set<string>()
  for (let i = 0; i < hashes.length; i += 100) {
    const batch = hashes.slice(i, i + 100)
    let rows: any[] = []
    for (let attempt = 0; attempt < 3 && !rows.length; attempt++) {
      const json = await requestJson<any>('http://gateway.kugou.com/v2/album_audio/audio', {
        method: 'POST',
        headers: {
          'KG-THash': '13a3164',
          'KG-RC': '1',
          'KG-Fake': '0',
          'KG-RF': '00869891',
          'User-Agent': 'Android712-AndroidPhone-11451-376-0-FeeCacheUpdate-wifi',
          'x-router': 'kmr.service.kugou.com'
        },
        body: {
          area_code: '1',
          show_privilege: 1,
          show_album_info: '1',
          is_publish: '',
          appid: 1005,
          clientver: 11451,
          mid: '1',
          dfid: '-',
          clienttime: Date.now(),
          key: 'OIlwieks28dk2k092lksi2UIkp',
          fields: 'album_info,author_name,audio_info,ori_audio_name,base,songname',
          data: batch.map((hash) => ({ hash }))
        }
      }).catch(() => null)
      if (json?.error_code === 0 && Array.isArray(json.data)) rows = json.data
    }
    for (const row of rows) {
      const item = parseKgAudioInfo(Array.isArray(row) ? row[0] : row)
      if (!item) continue
      const key = item.audioId || item.hash
      if (seen.has(key)) continue
      seen.add(key)
      out.push(item)
    }
  }
  return out
}
