import { existsSync, readFileSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
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
import { resolveMediaInfo as resolveMedia, invalidateMediaUrl } from '../../providers/getUrl'
import { registerAudioStream } from '../../audio/protocol'
import { getCachedLyric, setCachedLyric } from '../../cache/lyricCache'
import { getRedirect } from '../../store/library'

/**
 * 播放/歌词相关 IPC。
 * - 播放地址：走 getUrl.resolveMediaInfo（Provider 自定义优先，否则后端 getUrl + 注入 authst）。
 * - 音频流：解析后注册到 kunyin:// 协议，返回协议 URL 喂 <audio>（统一超时/解密/自愈）。
 * - 歌词：分发到 Provider。
 */

/** 读本地歌曲的同目录同名 .lrc 歌词；utf-8 优先，乱码时回退 gb18030 */
function readSidecarLrc(filePath?: string): string {
  if (!filePath) return ''
  try {
    const lrcPath = join(dirname(filePath), `${basename(filePath, extname(filePath))}.lrc`)
    if (!existsSync(lrcPath)) return ''
    const buf = readFileSync(lrcPath)
    const utf8 = buf.toString('utf-8')
    // U+FFFD 出现说明不是合法 utf-8，按国标编码重解
    if (utf8.includes('�')) return new TextDecoder('gb18030').decode(buf)
    return utf8
  } catch {
    return ''
  }
}

export function registerPlayerHandlers(): void {
  handle(
    IpcChannels.PLAYER_RESOLVE_URL,
    (item: MusicItem, qualityId: string): Promise<MediaInfoResult> => resolveMedia(item, qualityId)
  )

  handle(
    IpcChannels.PLAYER_STREAM,
    async (item: MusicItem, qualityId: string): Promise<AudioStreamResult> => {
      // 本地歌曲：不走解析后端，直接注册文件流
      if (item.type === 'local') {
        if (!item.filePath || !existsSync(item.filePath)) {
          return { ok: false, url: '', expire: 0, quality: qualityId, reason: '本地文件不存在' }
        }
        const url = registerAudioStream({ filePath: item.filePath })
        return { ok: true, url, expire: 0, quality: qualityId }
      }
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
      // 一律走 kunyin:// 协议，不只为解密：协议侧带「等响应头超时 + 网络抖动清连接池重试」
      // 的自愈逻辑。此前非加密流让 <audio> 直连 CDN，没有任何超时/自愈——连接池被半死
      // 连接占满（VPN/代理切换后常见）时直连请求永远挂起且不触发 error 事件，表现为
      // 「莫名其妙播不了、只能杀进程重启」；统一走协议后由主进程兜底自愈。
      const url = registerAudioStream({
        url: info.playUrl,
        ekey: info.encryptionInfo?.ekey,
        cipher: info.encryptionInfo?.cipher
      })
      return { ok: true, url, expire: info.expire ?? 0, quality: info.quality || qualityId }
    }
  )

  handle(IpcChannels.PLAYER_LYRIC, async (item: MusicItem): Promise<Lyric> => {
    // 歌词重定向：改用目标歌曲取词；缓存键随目标走（对齐安卓 MusicRepository.getLyric），
    // 设置/清除重定向后键自然切换，无需失效旧缓存
    const target = getRedirect(item) ?? item
    // 本地歌曲：读同目录同名 .lrc 边车（不缓存，文件可随时被用户替换）
    if (target.type === 'local') {
      return { ...EMPTY_LYRIC, lrc: readSidecarLrc(target.filePath) }
    }
    const cached = getCachedLyric(target)
    if (cached) return cached
    const lyric = (await getProvider(target.type)?.getLyric(target)) ?? { ...EMPTY_LYRIC }
    setCachedLyric(target, lyric) // 空歌词也缓存（负缓存），避免每次播放重复拉
    return lyric
  })
  // 播放失败（直链过期/403）：渲染层上报，使 URL 缓存失效后重新解析
  handle(IpcChannels.PLAYER_URL_INVALIDATE, (item: MusicItem, qualityId: string): void => {
    invalidateMediaUrl(item, qualityId)
  })
}
