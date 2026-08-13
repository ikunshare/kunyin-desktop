/* eslint-disable @typescript-eslint/no-explicit-any */
/** 酷狗歌词：搜索候选 → 下载 → KRC 解密 → 增强 LRC（移植自 KgProvider 歌词链） */
import OpenCC from 'opencc-js'
import { EMPTY_LYRIC, type KgLyricCandidate, type KugouMusicItem, type Lyric } from '@common'
import { requestJson } from '../../net/request'
import { decryptKrc, parseKrc } from '../../crypto/lyric'
import { kgSign, nowSec } from './sign'

const HOSTS = [
  'https://lyrics2.kugou.com',
  'https://lyrics.kugou.com',
  'https://krcsretry.kugou.com'
]

// 酷狗搜索对简体关键词命中更稳定；使用 OpenCC 通用繁体 → 大陆简体词典。
const toSimplified = OpenCC.Converter({ from: 'tw', to: 'cn' })

interface Candidate {
  accessKey: string
  downloadId: string
  contenttype: number
}

function signedLyricQuery(params: Record<string, string>): string {
  return (
    Object.entries(params)
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join('&') + `&signature=${kgSign(params)}`
  )
}

/**
 * 搜索酷狗歌词候选（对齐安卓 searchKgLyricCandidates）。
 * hash/audioId 可空——为非酷狗源做歌词重定向时只用关键词 + 时长。
 */
export async function searchKgLyricCandidates(
  keyword: string,
  durationMs: number,
  hash?: string,
  audioId?: string,
  man?: boolean
): Promise<KgLyricCandidate[]> {
  const params: Record<string, string> = {
    album_audio_id: audioId || '0',
    appid: '1005',
    clientver: '20744',
    duration: String(durationMs),
    keyword,
    lrctxt: '1',
    man: man ? 'yes' : 'no',
    query_copyright: '1',
    vocab: '0'
  }
  if (hash) params.hash = hash.toLowerCase()
  const query = signedLyricQuery(params)
  for (const host of HOSTS) {
    const json = await requestJson<any>(`${host}/v1/search?${query}`, {
      headers: { clienttime: nowSec(), mid: '-', dfid: '-' }
    }).catch(() => null)
    if (json && json.status === 200 && json.error_code !== 20006) {
      return (json.candidates ?? [])
        .map((c: any): KgLyricCandidate => ({
          accessKey: String(c.accesskey ?? ''),
          downloadId: String(c.id ?? c.download_id ?? ''),
          contenttype: Number(c.contenttype) || 0,
          song: String(c.song ?? ''),
          singer: String(c.singer ?? ''),
          language: String(c.language ?? ''),
          durationMs: Number(c.duration) || 0,
          score: Number(c.score) || 0,
          typeBadges: []
        }))
        .filter((c: KgLyricCandidate) => c.accessKey && c.downloadId)
    }
  }
  return []
}

/**
 * 探测一条候选的歌词内容类型（下载 + 解密后看各轨是否非空）。
 * 对应安卓 probeKgLyricTypes；失败返回空数组（UI 不显示徽标即可）。
 */
export async function probeKgLyricTypes(c: {
  accessKey: string
  downloadId: string
  contenttype: number
}): Promise<string[]> {
  const content = await download(c)
  if (!content) return []
  const r = parseKrc(decryptKrc(Buffer.from(content, 'base64')))
  const badges: string[] = []
  if (r.char) badges.push('逐字')
  else if (r.lrc) badges.push('逐行')
  if (r.trans) badges.push('翻译')
  if (r.roma) badges.push('音译')
  if (r.chroma) badges.push('逐字音译')
  if (r.phonetic) badges.push('谐音')
  return badges
}

function buildSimplifiedKeyword(title: string, artist: string): string {
  const simplifiedTitle = toSimplified(title).trim()
  const simplifiedArtist = toSimplified(artist).trim()
  if (!simplifiedTitle) return ''
  return simplifiedArtist ? `${simplifiedArtist} - ${simplifiedTitle}` : simplifiedTitle
}

async function searchCandidates(
  title: string,
  artist: string,
  durationMs: number,
  hash?: string,
  audioId?: string
): Promise<Candidate[]> {
  const keyword = buildSimplifiedKeyword(title, artist)
  if (!keyword) return []
  return searchKgLyricCandidates(keyword, durationMs, hash, audioId)
}

async function download(c: Candidate): Promise<string | null> {
  const query = signedLyricQuery({
    accesskey: c.accessKey,
    appid: '1005',
    clientver: '20669',
    contenttype: String(c.contenttype),
    download_id: c.downloadId
  })
  for (const host of HOSTS) {
    const json = await requestJson<any>(`${host}/v2/download?${query}`, {
      headers: { clienttime: nowSec(), mid: '-', dfid: '-' }
    }).catch(() => null)
    if (json && json.status === 1 && json.error_code !== 20006) return json.data?.content ?? null
  }
  return null
}

function decodeKrcContent(content: string): Lyric {
  const r = parseKrc(decryptKrc(Buffer.from(content, 'base64')))
  if (!r.lrc) return { ...EMPTY_LYRIC }
  return {
    lrc: r.lrc,
    trans: r.trans,
    roma: r.roma,
    char: r.char,
    chroma: r.chroma,
    phonetic: r.phonetic
  }
}

/** 按酷狗候选顺序尝试下载，首条失效时继续尝试后两条。 */
async function downloadFirstAvailable(candidates: Candidate[]): Promise<Lyric> {
  for (const candidate of candidates.slice(0, 3)) {
    const content = await download(candidate)
    if (!content) continue
    const lyric = decodeKrcContent(content)
    if (lyric.char.trim() || lyric.lrc.trim()) return lyric
  }
  return { ...EMPTY_LYRIC }
}

/**
 * 所有音源共用的酷狗歌词回退：歌名、歌手先繁转简，再按「歌手 - 歌名 + 时长」自动搜词。
 */
export async function getKgFallbackLyric(
  title: string,
  artist: string,
  durationMs: number
): Promise<Lyric> {
  const candidates = await searchCandidates(title, artist, durationMs)
  return downloadFirstAvailable(candidates)
}

export async function getKgLyric(kg: KugouMusicItem): Promise<Lyric> {
  // 直链重定向：已带 accesskey + downloadId 时跳过搜索直接下载（对齐 KgProvider.getLyric）
  if (kg.lyricAccessKey && kg.lyricDownloadId) {
    const direct = await download({
      accessKey: kg.lyricAccessKey,
      downloadId: kg.lyricDownloadId,
      contenttype: 0
    })
    if (direct) {
      const lyric = decodeKrcContent(direct)
      if (lyric.lrc) return lyric
    }
    // 直链失败则回退常规搜索流程
  }
  const candidates = await searchCandidates(kg.title, kg.artist, kg.duration, kg.hash, kg.audioId)
  return downloadFirstAvailable(candidates)
}
