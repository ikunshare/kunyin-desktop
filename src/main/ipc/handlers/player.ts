import {
  EMPTY_LYRIC,
  IpcChannels,
  type AudioStreamResult,
  type Lyric,
  type MediaInfoResult,
  type MusicItem
} from '@common'
import { handle } from '../helpers'
import { getProvider } from '../../providers'
import { resolveMediaInfo as resolveMedia } from '../../providers/getUrl'
import { registerAudioStream } from '../../audio/protocol'

/**
 * 播放/歌词相关 IPC。
 * - 播放地址：走 getUrl.resolveMediaInfo（Provider 自定义优先，否则后端 getUrl + 注入 authst）。
 * - 音频流：解析后注册到本地代理，返回 127.0.0.1 URL 喂 <audio>。
 * - 歌词：分发到 Provider。
 */

export function registerPlayerHandlers(): void {
  handle(
    IpcChannels.PLAYER_RESOLVE_URL,
    (item: MusicItem, qualityId: string): Promise<MediaInfoResult> => resolveMedia(item, qualityId)
  )

  handle(
    IpcChannels.PLAYER_STREAM,
    async (item: MusicItem, qualityId: string): Promise<AudioStreamResult> => {
      const info = await resolveMedia(item, qualityId)
      if (!info.isSuccess || !info.playUrl) {
        return {
          ok: false,
          url: '',
          expire: 0,
          quality: qualityId,
          reason: info.rejectReason ?? '解析播放地址失败'
        }
      }
      const ekey = info.encryptionInfo?.ekey
      // 非加密流：直接返回直链，<audio> 直连（CSP media-src 放行 http/https），跳过协议；
      // 加密流：走 kunyin:// 协议边下边解密。
      const url = ekey ? registerAudioStream({ url: info.playUrl, ekey }) : info.playUrl
      return { ok: true, url, expire: info.expire ?? 0, quality: info.quality || qualityId }
    }
  )

  handle(IpcChannels.PLAYER_LYRIC, async (item: MusicItem): Promise<Lyric> => {
    return (await getProvider(item.type)?.getLyric(item)) ?? { ...EMPTY_LYRIC }
  })
}
