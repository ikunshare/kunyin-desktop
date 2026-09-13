/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 酷我评论（移植自 LX `musicSdk/kw/comment.js`）。
 * 「最新」与「热门」是同一接口的两个 type，返回结构一致。
 */
import type { CommentItem, CommentResult, MusicItem } from '@common'
import { requestJson } from '../../net/request'
import { commentTimeStr, maxPageOf, secToMs } from '../comment'

const KW_UA = 'Dalvik/2.1.0 (Linux; U; Android 9;)'

function buildUrl(type: string, songId: string, page: number, limit: number): string {
  const start = limit * (page - 1)
  return (
    `http://ncomment.kuwo.cn/com.s?f=web&type=${type}&aapiver=1&prod=kwplayer_ar_10.5.2.0` +
    `&digest=15&sid=${songId}&start=${start}&msgflag=1&count=${limit}&newver=3&uid=0`
  )
}

function mapOne(item: any): CommentItem {
  const time = secToMs(item.time)
  return {
    id: String(item.id),
    text: item.msg ?? '',
    time,
    timeStr: commentTimeStr(time),
    userName: item.u_name ?? '',
    avatar: item.u_pic,
    userId: item.u_id != null ? String(item.u_id) : undefined,
    likedCount: Number(item.like_num ?? 0),
    // 图片地址在接口里是 URL 编码过的
    images: item.mpic ? [decodeURIComponent(item.mpic)] : [],
    reply: Array.isArray(item.child_comments) ? item.child_comments.map(mapOne) : []
  }
}

function mapList(raw: any): CommentItem[] {
  return Array.isArray(raw) ? raw.map(mapOne) : []
}

export async function kwGetComment(
  item: MusicItem,
  page: number,
  limit: number
): Promise<CommentResult> {
  const json = await requestJson<any>(buildUrl('get_comment', String(item.id), page, limit), {
    headers: { 'User-Agent': KW_UA }
  })
  if (String(json?.code) !== '200') throw new Error('获取评论失败')

  const total = Number(json.comments_counts ?? 0)
  return {
    source: 'kw',
    comments: mapList(json.comments),
    total,
    page,
    limit,
    maxPage: maxPageOf(total, limit)
  }
}

export async function kwGetHotComment(
  item: MusicItem,
  page: number,
  limit: number
): Promise<CommentResult> {
  const json = await requestJson<any>(buildUrl('get_rec_comment', String(item.id), page, limit), {
    headers: { 'User-Agent': KW_UA }
  })
  if (String(json?.code) !== '200') throw new Error('获取热门评论失败')

  const total = Number(json.hot_comments_counts ?? 0)
  return {
    source: 'kw',
    comments: mapList(json.hot_comments),
    total,
    page,
    limit,
    maxPage: maxPageOf(total, limit)
  }
}
