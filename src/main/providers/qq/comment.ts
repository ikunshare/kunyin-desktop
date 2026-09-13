/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * QQ 音乐评论（移植自 LX `musicSdk/tx/comment.js`）。
 *
 * 「最新」走 h5 的 fcg_global_comment_h5.fcg，「热门」走 musicu 的
 * GetHotCommentList——两个接口返回的字段名完全不同（一个全小写、一个大驼峰），
 * 故分别有各自的映射函数。两者都以数字 songId（= MusicItem.id）为 key。
 */
import type { CommentItem, CommentResult, MusicItem } from '@common'
import { requestJson } from '../../net/request'
import { commentTimeStr, maxPageOf, secToMs } from '../comment'

const H5_UA = 'Mozilla/5.0 (compatible; MSIE 9.0; Windows NT 6.1; WOW64; Trident/5.0)'
const WEB_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

/** QQ 评论里的 `[em]e400846[/em]` 形式表情 → Unicode emoji */
const EMOJIS: Record<string, string> = {
  e400846: '😘',
  e400874: '😴',
  e400825: '😃',
  e400847: '😙',
  e400835: '😍',
  e400873: '😳',
  e400836: '😎',
  e400867: '😭',
  e400832: '😊',
  e400837: '😏',
  e400875: '😫',
  e400831: '😉',
  e400855: '😡',
  e400823: '😄',
  e400862: '😨',
  e400844: '😖',
  e400841: '😓',
  e400830: '😈',
  e400828: '😆',
  e400833: '😋',
  e400822: '😀',
  e400843: '😕',
  e400829: '😇',
  e400824: '😂',
  e400834: '😌',
  e400877: '😷',
  e400132: '🍉',
  e400181: '🍺',
  e401067: '☕️',
  e400186: '🥧',
  e400343: '🐷',
  e400116: '🌹',
  e400126: '🍃',
  e400613: '💋',
  e401236: '❤️',
  e400622: '💔',
  e400637: '💣',
  e400643: '💩',
  e400773: '🔪',
  e400102: '🌛',
  e401328: '🌞',
  e400420: '👏',
  e400914: '🙌',
  e400408: '👍',
  e400414: '👎',
  e401121: '✋',
  e400396: '👋',
  e400384: '👉',
  e401115: '✊',
  e400402: '👌',
  e400905: '🙈',
  e400906: '🙉',
  e400907: '🙊',
  e400562: '👻',
  e400932: '🙏',
  e400644: '💪',
  e400611: '💉',
  e400185: '🎁',
  e400655: '💰',
  e400325: '🐥',
  e400612: '💊',
  e400198: '🎉',
  e401685: '⚡️',
  e400631: '💝',
  e400768: '🔥',
  e400432: '👑'
}

/** 表情占位替换 + 把接口里字面量的 `\n` 还原成真换行 */
function normalizeText(msg: string | undefined | null): string {
  if (!msg) return ''
  return msg
    .replace(/\[em\](e\d+)\[\/em\]/g, (_m, code: string) => EMOJIS[code] ?? '')
    .replace(/\\n/g, '\n')
}

/** 最新评论：字段全小写，回复链在 middlecommentcontent 里（接口给的是倒序） */
function mapNewComment(item: any): CommentItem {
  const time = secToMs(item.time)
  const timeStr = commentTimeStr(time)
  const isRoot = item.rootcommentid == item.commentid
  const mid: any[] = Array.isArray(item.middlecommentcontent) ? [...item.middlecommentcontent] : []
  // 头像/点赞数接口只在外层给了一份，实际属于回复链的第一条；挪过去再反转成正序
  let rootAvatar: string | undefined = item.avatarurl
  let rootLiked: number | null = item.praisenum ?? 0
  if (mid.length) {
    mid[0] = { ...mid[0], avatarurl: item.avatarurl, praisenum: item.praisenum }
    mid.reverse()
    rootAvatar = undefined
    rootLiked = null
  }

  return {
    id: `${item.rootcommentid}_${item.commentid}`,
    text: normalizeText(item.rootcommentcontent),
    time: isRoot ? time : 0,
    timeStr: isRoot ? timeStr : '',
    userName: item.rootcommentnick ? String(item.rootcommentnick).substring(1) : '',
    avatar: rootAvatar,
    userId: item.encrypt_rootcommentuin,
    likedCount: rootLiked,
    reply: mid.map((c) => {
      const isCur = c.subcommentid == item.commentid
      return {
        id: `sub_${item.rootcommentid}_${c.subcommentid}`,
        text: normalizeText(c.subcommentcontent),
        time: isCur ? time : 0,
        timeStr: isCur ? timeStr : '',
        userName: c.replynick ? String(c.replynick).substring(1) : '',
        avatar: c.avatarurl,
        userId: c.encrypt_replyuin,
        likedCount: c.praisenum ?? 0,
        reply: []
      }
    })
  }
}

/** 热门评论：musicu 接口的大驼峰字段，子评论已是正序 */
function mapHotComment(item: any): CommentItem {
  const time = secToMs(item.PubTime)
  return {
    id: `${item.SeqNo}_${item.CmId}`,
    text: normalizeText(item.Content),
    time,
    timeStr: commentTimeStr(time),
    userName: item.Nick ?? '',
    avatar: item.Avatar,
    userId: item.EncryptUin,
    location: item.Location || undefined,
    likedCount: item.PraiseNum ?? 0,
    images: item.Pic ? [item.Pic] : [],
    reply: Array.isArray(item.SubComments)
      ? item.SubComments.map((c: any) => {
          const t = secToMs(c.PubTime)
          return {
            id: `sub_${c.SeqNo}_${c.CmId}`,
            text: normalizeText(c.Content),
            time: t,
            timeStr: commentTimeStr(t),
            userName: c.Nick ?? '',
            avatar: c.Avatar,
            userId: c.EncryptUin,
            location: c.Location || undefined,
            likedCount: c.PraiseNum ?? 0,
            images: c.Pic ? [c.Pic] : [],
            reply: []
          }
        })
      : []
  }
}

export async function qqGetComment(
  item: MusicItem,
  page: number,
  limit: number
): Promise<CommentResult> {
  const json = await requestJson<any>('http://c.y.qq.com/base/fcgi-bin/fcg_global_comment_h5.fcg', {
    method: 'POST',
    headers: { 'User-Agent': H5_UA },
    body: new URLSearchParams({
      uin: '0',
      format: 'json',
      cid: '205360772',
      reqtype: '2',
      biztype: '1',
      topid: String(item.id),
      cmd: '8',
      needmusiccrit: '1',
      pagenum: String(page - 1),
      pagesize: String(limit)
    })
  })
  if (json?.code !== 0) throw new Error('获取评论失败')

  const c = json.comment ?? {}
  const total = c.commenttotal ?? 0
  return {
    source: 'qq',
    comments: Array.isArray(c.commentlist) ? c.commentlist.map(mapNewComment) : [],
    total,
    page,
    limit,
    maxPage: maxPageOf(total, limit)
  }
}

export async function qqGetHotComment(
  item: MusicItem,
  page: number,
  limit: number
): Promise<CommentResult> {
  const json = await requestJson<any>('https://u.y.qq.com/cgi-bin/musicu.fcg', {
    method: 'POST',
    headers: { 'User-Agent': WEB_UA, referer: 'https://y.qq.com/', origin: 'https://y.qq.com' },
    body: {
      comm: {
        cv: 4747474,
        ct: 24,
        format: 'json',
        inCharset: 'utf-8',
        outCharset: 'utf-8',
        notice: 0,
        platform: 'yqq.json',
        needNewCode: 1,
        uin: 0
      },
      req: {
        module: 'music.globalComment.CommentRead',
        method: 'GetHotCommentList',
        param: {
          BizType: 1,
          BizId: String(item.id),
          LastCommentSeqNo: '',
          PageSize: limit,
          PageNum: page - 1,
          HotType: 1,
          WithAirborne: 0,
          PicEnable: 1
        }
      }
    }
  })
  if (json?.code !== 0 || json.req?.code !== 0) throw new Error('获取热门评论失败')

  const list = json.req.data?.CommentList ?? {}
  const total = list.Total ?? 0
  return {
    source: 'qq',
    comments: Array.isArray(list.Comments) ? list.Comments.map(mapHotComment) : [],
    total,
    page,
    limit,
    maxPage: maxPageOf(total, limit)
  }
}
