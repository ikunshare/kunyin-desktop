import { IpcChannels, type CommentResult, type MusicItem, type MusicSource } from '@common'
import { handle } from '../helpers'
import { getProvider } from '../../providers'

/** 空结果：音源不支持评论、或本地文件时返回 */
function empty(source: MusicSource, page: number, limit: number): CommentResult {
  return { source, comments: [], total: 0, page, limit, maxPage: 1 }
}

/** 歌曲评论 IPC —— 分发到各音源 Provider 的 getComment/getHotComment */
export function registerCommentHandlers(): void {
  handle(IpcChannels.COMMENT_SUPPORTED, (source: MusicSource): Promise<boolean> => {
    return Promise.resolve(getProvider(source)?.supportsComment() ?? false)
  })
  handle(
    IpcChannels.COMMENT_NEW,
    (item: MusicItem, page: number = 1, limit: number = 20): Promise<CommentResult> => {
      const provider = getProvider(item.type)
      if (!provider?.supportsComment()) return Promise.resolve(empty(item.type, page, limit))
      return provider.getComment(item, page, limit)
    }
  )
  handle(
    IpcChannels.COMMENT_HOT,
    (item: MusicItem, page: number = 1, limit: number = 20): Promise<CommentResult> => {
      const provider = getProvider(item.type)
      if (!provider?.supportsComment()) return Promise.resolve(empty(item.type, page, limit))
      return provider.getHotComment(item, page, limit)
    }
  )
}
