import { existsSync, readFileSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import {
  EMPTY_LYRIC,
  IpcChannels,
  type AudioStreamResult,
  type Lyric,
  type MediaInfoResult,
  type MusicItem,
  type NeteaseMusicItem,
  type QQMusicItem,
  type QQReportEvent,
  type WyReportEvent,
  softDecoder
} from '@common'
import { handle } from '../helpers'
import { getProvider } from '../../providers'
import { resolveMediaInfo as resolveMedia, invalidateMediaUrl } from '../../providers/getUrl'
import { registerAudioStream } from '../../audio/protocol'
import { audioCacheKey, dropCachedAudio, isAudioFullyCached } from '../../cache/audioCache'
import { getCachedLyric, setCachedLyric } from '../../cache/lyricCache'
import { getRedirect } from '../../store/library'
import { getKgFallbackLyric } from '../../providers/kg/lyric'
import {
  qqReportListening,
  qqReportPlayRecently,
  qqReportPlayStream,
  type QQReportCreds
} from '../../providers/qq/report'
import {
  toReportSong,
  wyReportPlayEnd,
  wyReportPlayStart,
  type WyReportSource
} from '../../providers/wy/report'

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

function hasMainLyric(lyric: Lyric): boolean {
  return !!(lyric.char.trim() || lyric.lrc.trim())
}

async function loadKgFallback(item: MusicItem): Promise<Lyric> {
  return getKgFallbackLyric(item.title, item.artist, item.duration).catch(() => ({
    ...EMPTY_LYRIC
  }))
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
      // 完整命中音频缓存：所有块都在，连后端 getUrl 都不必发。
      // 判定必须在解析之前，所以键用「请求的」音质档（见 audioCacheKey）。
      const cacheKey = audioCacheKey(item, qualityId)
      // Chromium 解不了的码流（网易 / QQ 杜比）由协议层软解成 WAV；缓存里存的仍是原文件
      const decode = softDecoder(qualityId, item.type)
      if (isAudioFullyCached(cacheKey)) {
        // 不带 url：协议层看到条目齐全，全程走本地块
        const url = registerAudioStream({ cacheKey, decode })
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
      // 一律走 kunyin:// 协议：加密格式（QQ .mflac/.mgg 等）必须边下边解密；
      // 普通格式也由协议层统一提供响应头超时和局部重试。重试不得清空全局连接池，
      // 否则切歌时会误杀另一首正在建立的连接并制造 ERR_ABORTED。
      // cacheKey 让协议层按块落盘，并在部分命中时只回源缺的那几块。
      const url = registerAudioStream({
        url: info.playUrl,
        ekey: info.encryptionInfo?.ekey,
        cacheKey,
        decode
      })
      return { ok: true, url, expire: info.expire ?? 0, quality: info.quality || qualityId }
    }
  )

  handle(IpcChannels.PLAYER_LYRIC, async (item: MusicItem): Promise<Lyric> => {
    // 歌词重定向：改用目标歌曲取词；缓存键随目标走（对齐安卓 MusicRepository.getLyric），
    // 设置/清除重定向后键自然切换，无需失效旧缓存
    const target = getRedirect(item) ?? item

    // 本地同名歌词优先且不缓存，文件被替换后可立即生效；没有边车时也进入酷狗回退。
    if (target.type === 'local') {
      const sidecar = readSidecarLrc(target.filePath)
      if (sidecar.trim()) return { ...EMPTY_LYRIC, lrc: sidecar }
    }

    const cached = getCachedLyric(target)
    if (cached) {
      if (hasMainLyric(cached.lyric) || cached.fallbackChecked) return cached.lyric
      // 旧版空缓存没有跑过全平台回退，只补搜酷狗，不重复请求原平台。
      const fallback = await loadKgFallback(target)
      setCachedLyric(target, fallback)
      return fallback
    }

    let lyric =
      target.type === 'local'
        ? { ...EMPTY_LYRIC }
        : ((await getProvider(target.type)
            ?.getLyric(target)
            .catch(() => ({ ...EMPTY_LYRIC }))) ?? { ...EMPTY_LYRIC })
    if (!hasMainLyric(lyric)) lyric = await loadKgFallback(target)

    // 空歌词也缓存（负缓存）；fallbackVersion 防止旧负缓存挡住新回退，同时避免反复搜词。
    setCachedLyric(target, lyric)
    return lyric
  })
  // 播放失败（直链过期/403/缓存文件损坏）：渲染层上报，使缓存失效后重新解析
  handle(IpcChannels.PLAYER_URL_INVALIDATE, (item: MusicItem, qualityId: string): void => {
    invalidateMediaUrl(item, qualityId)
    // 命中音频缓存的那一路不碰网络，只失效直链缓存的话重试还会撞上同一个坏文件
    dropCachedAudio(audioCacheKey(item, qualityId))
  })

  // QQ 音乐听歌上报：设置关闭 / 未登录 / 非 QQ 曲目一律跳过；失败静默
  handle(IpcChannels.PLAYER_QQ_REPORT, async (event: QQReportEvent): Promise<boolean> => {
    if (event.item.type !== 'qq') return false
    const creds = getProvider('qq')?.credentials as QQReportCreds | null | undefined
    if (!creds?.uin || !creds.authst) return false
    const song = event.item as QQMusicItem
    switch (event.kind) {
      case 'listening':
        return qqReportListening(creds, song, event.playTimeMs, event.playList)
      case 'recently':
        return qqReportPlayRecently(creds, song)
      case 'stream':
        return qqReportPlayStream(creds, song, event.playTimeSec)
      default:
        return false
    }
  })

  // 网易云听歌上报：非网易云曲目 / 未登录一律跳过；失败静默
  handle(IpcChannels.PLAYER_WY_REPORT, async (event: WyReportEvent): Promise<boolean> => {
    if (event.item.type !== 'wy') return false
    const cookie = getProvider('wy')?.credentials?.cookie
    if (!cookie) return false
    const song = toReportSong(event.item as NeteaseMusicItem, event.qualityId)
    // 来源三元组照上游抓包原样用（refer 串里嵌着「我喜欢的音乐」那条 spm 路径，成套不拆），
    // 只有列表 id 换成实际在放的网易云歌单。
    const source: WyReportSource = { id: event.sourceId || '0', type: 'track', name: 'likeMusic' }
    switch (event.kind) {
      case 'start':
        return wyReportPlayStart(cookie, song, source)
      case 'end':
        return wyReportPlayEnd(cookie, song, source, event.playTimeSec)
      default:
        return false
    }
  })
}
