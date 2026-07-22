/* eslint-disable @typescript-eslint/no-explicit-any */
/** 酷狗歌词：搜索候选 → 下载 → KRC 解密 → 增强 LRC（移植自 KgProvider 歌词链） */
import { EMPTY_LYRIC, type KugouMusicItem, type Lyric } from '@common'
import { requestJson } from '../../net/request'
import { decryptKrc, krcToLrc } from '../../crypto/lyric'
import { kgSign, nowSec } from './sign'

const HOSTS = [
  'https://lyrics2.kugou.com',
  'https://lyrics.kugou.com',
  'https://krcsretry.kugou.com'
]

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

async function searchCandidates(kg: KugouMusicItem): Promise<Candidate[]> {
  const params: Record<string, string> = {
    album_audio_id: kg.audioId || '0',
    appid: '1005',
    clientver: '20669',
    duration: String(kg.duration),
    keyword: `${kg.artist} - ${kg.title}`,
    lrctxt: '1',
    man: 'yes',
    query_copyright: '1',
    vocab: '0'
  }
  if (kg.hash) params.hash = kg.hash.toLowerCase()
  const query = signedLyricQuery(params)
  for (const host of HOSTS) {
    const json = await requestJson<any>(`${host}/v1/search?${query}`, {
      headers: { clienttime: nowSec(), mid: '-', dfid: '-' }
    }).catch(() => null)
    if (json && json.status === 200 && json.error_code !== 20006) {
      return (json.candidates ?? []).map((c: any) => ({
        accessKey: c.accesskey,
        downloadId: String(c.id ?? c.download_id ?? ''),
        contenttype: Number(c.contenttype) || 0
      }))
    }
  }
  return []
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
  const lrc = krcToLrc(decryptKrc(Buffer.from(content, 'base64')))
  if (!lrc) return { ...EMPTY_LYRIC }
  return { lrc, trans: '', roma: '', char: lrc, chroma: '', phonetic: '' }
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
  const candidates = await searchCandidates(kg)
  if (!candidates.length) return { ...EMPTY_LYRIC }
  const content = await download(candidates[0])
  if (!content) return { ...EMPTY_LYRIC }
  return decodeKrcContent(content)
}
