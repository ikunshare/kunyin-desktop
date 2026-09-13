/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 网易云评论（移植自 LX `musicSdk/wy/comment.js`）。
 *
 * 新版评论接口是「游标翻页」而非 offset 翻页：翻页要带上一页返回的 cursor，
 * 并用 orderType 指示往前/往后翻。因此这里按 songId 缓存游标状态，跨调用保持。
 */
import type { CommentItem, CommentResult, MusicItem } from '@common'
import { weapiPost } from '../../crypto/netease'
import { commentTimeStr, maxPageOf } from '../comment'

/** 网易云评论里的 `[大笑]` 形式表情 → Unicode emoji */
const EMOJIS: Array<[string, string]> = [
  ['大笑', '😃'],
  ['可爱', '😊'],
  ['憨笑', '☺️'],
  ['色', '😍'],
  ['亲亲', '😙'],
  ['惊恐', '😱'],
  ['流泪', '😭'],
  ['亲', '😚'],
  ['呆', '😳'],
  ['哀伤', '😔'],
  ['呲牙', '😁'],
  ['吐舌', '😝'],
  ['撇嘴', '😒'],
  ['怒', '😡'],
  ['奸笑', '😏'],
  ['汗', '😓'],
  ['痛苦', '😖'],
  ['惶恐', '😰'],
  ['生病', '😨'],
  ['口罩', '😷'],
  ['大哭', '😂'],
  ['晕', '😵'],
  ['发怒', '👿'],
  ['开心', '😄'],
  ['鬼脸', '😜'],
  ['皱眉', '😞'],
  ['流感', '😢'],
  ['爱心', '❤️'],
  ['心碎', '💔'],
  ['钟情', '💘'],
  ['星星', '⭐️'],
  ['生气', '💢'],
  ['便便', '💩'],
  ['强', '👍'],
  ['弱', '👎'],
  ['拜', '🙏'],
  ['牵手', '👫'],
  ['跳舞', '👯‍♀️'],
  ['禁止', '🙅‍♀️'],
  ['这边', '💁‍♀️'],
  ['爱意', '💏'],
  ['示爱', '👩‍❤️‍👨'],
  ['嘴唇', '👄'],
  ['狗', '🐶'],
  ['猫', '🐱'],
  ['猪', '🐷'],
  ['兔子', '🐰'],
  ['小鸡', '🐤'],
  ['公鸡', '🐔'],
  ['幽灵', '👻'],
  ['圣诞', '🎅'],
  ['外星', '👽'],
  ['钻石', '💎'],
  ['礼物', '🎁'],
  ['男孩', '👦'],
  ['女孩', '👧'],
  ['蛋糕', '🎂'],
  ['18', '🔞'],
  ['圈', '⭕'],
  ['叉', '❌']
]

function applyEmoji(text: string): string {
  let out = text
  for (const [name, emoji] of EMOJIS) out = out.replaceAll(`[${name}]`, emoji)
  return out
}

interface CursorState {
  page: number
  cursor: number
  prevCursor: number
  orderType: number
  offset: number
}

/** 按歌曲缓存游标：翻页要拿上一次的 cursor 续接，首页才用当前时间戳重置 */
const cursorCache = new Map<string, CursorState>()

function getCursor(
  id: string,
  page: number,
  limit: number
): Pick<CursorState, 'cursor' | 'orderType' | 'offset'> {
  const cached = cursorCache.get(id)
  if (page === 1 || !cached) {
    const cursor = Date.now()
    cursorCache.set(id, { page: 1, cursor, prevCursor: cursor, orderType: 1, offset: 0 })
    return { cursor, orderType: 1, offset: 0 }
  }
  if (page > cached.page) {
    return { cursor: cached.cursor, orderType: 1, offset: (page - cached.page - 1) * limit }
  }
  if (page < cached.page) {
    return { cursor: cached.cursor, orderType: 0, offset: (cached.page - page - 1) * limit }
  }
  // 同页重刷：退回上一页的游标，等价于「重新翻到本页」
  return { cursor: cached.prevCursor, orderType: cached.orderType, offset: cached.offset }
}

function setCursor(
  id: string,
  cursor: number,
  orderType: number,
  offset: number,
  page: number
): void {
  const cached = cursorCache.get(id)
  cursorCache.set(id, {
    page,
    cursor,
    prevCursor: cached?.cursor ?? cursor,
    orderType,
    offset
  })
}

/**
 * 一条网易云评论：接口把「被回复的原评论」放在 beReplied 里，
 * 这里按 LX 的做法反转层级——原评论当楼主、本条作为其 reply，读起来才是对话顺序。
 */
function mapComment(item: any): CommentItem {
  const self: CommentItem = {
    id: String(item.commentId),
    text: item.content ? applyEmoji(item.content) : '',
    time: item.time ?? 0,
    timeStr: item.time ? commentTimeStr(item.time) : '',
    location: item.ipLocation?.location,
    userName: item.user?.nickname ?? '',
    avatar: item.user?.avatarUrl,
    userId: item.user?.userId != null ? String(item.user.userId) : undefined,
    likedCount: item.likedCount ?? 0,
    reply: []
  }

  const replied = item.beReplied?.[0]
  if (!replied) return self
  return {
    id: String(item.commentId),
    text: replied.content ? applyEmoji(replied.content) : '',
    time: item.time ?? 0,
    timeStr: '',
    location: replied.ipLocation?.location,
    userName: replied.user?.nickname ?? '',
    avatar: replied.user?.avatarUrl,
    userId: replied.user?.userId != null ? String(replied.user.userId) : undefined,
    likedCount: null,
    reply: [self]
  }
}

function mapList(raw: any): CommentItem[] {
  return Array.isArray(raw) ? raw.map(mapComment) : []
}

export async function wyGetComment(
  item: MusicItem,
  page: number,
  limit: number
): Promise<CommentResult> {
  const songId = String(item.id)
  const threadId = `R_SO_4_${songId}`
  const cur = getCursor(songId, page, limit)

  const json = await weapiPost<any>('/comment/resource/comments/get', {
    cursor: cur.cursor,
    offset: cur.offset,
    orderType: cur.orderType,
    pageNo: page,
    pageSize: limit,
    rid: threadId,
    threadId
  })
  if (json?.code !== 200) throw new Error('获取评论失败')

  setCursor(songId, json.data.cursor, cur.orderType, cur.offset, page)
  const total = json.data.totalCount ?? 0
  return {
    source: 'wy',
    comments: mapList(json.data.comments),
    total,
    page,
    limit,
    maxPage: maxPageOf(total, limit)
  }
}

export async function wyGetHotComment(
  item: MusicItem,
  page: number,
  limit: number
): Promise<CommentResult> {
  const threadId = `R_SO_4_${item.id}`
  const json = await weapiPost<any>(`/v1/resource/hotcomments/${threadId}`, {
    rid: threadId,
    limit,
    offset: limit * (page - 1),
    beforeTime: String(Date.now())
  })
  if (json?.code !== 200) throw new Error('获取热门评论失败')

  const total = json.total ?? 0
  return {
    source: 'wy',
    comments: mapList(json.hotComments),
    total,
    page,
    limit,
    maxPage: maxPageOf(total, limit)
  }
}
