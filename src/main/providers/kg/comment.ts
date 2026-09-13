/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 酷狗评论（移植自 LX `musicSdk/kg/comment.js`）。
 * 以歌曲 hash 为 key，「最新」= rank/newest，「热门」= rank/topliked，返回结构一致。
 */
import type { CommentItem, CommentResult, KugouMusicItem, MusicItem } from '@common'
import { requestJson } from '../../net/request'
import { kgSign } from './sign'
import { commentTimeStr, maxPageOf } from '../comment'

const KG_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/107.0.0.0 Safari/537.36 Edg/107.0.1418.24'

/** 评论内容里带 HTML 实体，接口不解码 */
function decodeEntities(text: string): string {
  return text
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

/** `[at=123]` 占位 → `@昵称` */
function replaceAt(raw: string, atList: any[]): string {
  let out = raw
  for (const at of atList) out = out.replaceAll(`[at=${at.id}]`, `@${at.name} `)
  return out
}

function mapOne(item: any): CommentItem {
  // addtime 是 `yyyy-MM-dd HH:mm:ss` 文本
  const time = item.addtime ? new Date(item.addtime).getTime() || 0 : 0
  const self: CommentItem = {
    id: String(item.id),
    text: decodeEntities(
      (item.atlist ? replaceAt(item.content ?? '', item.atlist) : item.content) || ''
    ),
    images: Array.isArray(item.images) ? item.images.map((i: any) => i.url) : [],
    location: item.location || undefined,
    time,
    timeStr: commentTimeStr(time),
    userName: item.user_name ?? '',
    avatar: item.user_pic,
    userId: item.user_id != null ? String(item.user_id) : undefined,
    likedCount: item.like?.likenum ?? 0,
    reply: []
  }

  // pcontent 是「被回复的原评论」，同网易云的处理：提为楼主、本条作其回复
  if (!item.pcontent) return self
  return {
    id: String(item.id),
    text: decodeEntities(item.pcontent),
    time: 0,
    timeStr: '',
    userName: item.puser ?? '',
    userId: item.puser_id != null ? String(item.puser_id) : undefined,
    likedCount: null,
    reply: [self]
  }
}

async function fetchComment(
  path: 'newest' | 'topliked',
  hash: string,
  page: number,
  limit: number,
  errMsg: string,
  source: 'kg'
): Promise<CommentResult> {
  const params: Record<string, string> = {
    dfid: '0',
    mid: '16249512204336365674023395779019',
    clienttime: String(Date.now()),
    uuid: '0',
    extdata: hash,
    appid: '1005',
    code: 'fc4be23b4e972707f36b8a828a93ba8a',
    schash: hash,
    clientver: '11409',
    p: String(page),
    clienttoken: '',
    ver: '10',
    pagesize: String(limit),
    kugouid: '0'
  }
  const query = Object.entries(params)
    .map(([k, v]) => `${k}=${v}`)
    .join('&')
  const json = await requestJson<any>(
    `http://m.comment.service.kugou.com/r/v1/rank/${path}?${query}&signature=${kgSign(params)}`,
    { headers: { 'User-Agent': KG_UA } }
  )
  if (json?.err_code !== 0) throw new Error(errMsg)

  const total = json.count ?? 0
  return {
    source,
    comments: Array.isArray(json.list) ? json.list.map(mapOne) : [],
    total,
    page,
    limit,
    maxPage: maxPageOf(total, limit)
  }
}

function hashOf(item: MusicItem): string {
  const hash = (item as KugouMusicItem).hash
  if (!hash) throw new Error('该歌曲缺少 hash，无法获取评论')
  return hash
}

export async function kgGetComment(
  item: MusicItem,
  page: number,
  limit: number
): Promise<CommentResult> {
  return fetchComment('newest', hashOf(item), page, limit, '获取评论失败', 'kg')
}

export async function kgGetHotComment(
  item: MusicItem,
  page: number,
  limit: number
): Promise<CommentResult> {
  return fetchComment('topliked', hashOf(item), page, limit, '获取热门评论失败', 'kg')
}
