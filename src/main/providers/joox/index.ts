/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * JOOX Provider（1:1 移植自 Android JooxProvider.kt）。
 * 只实现 search + getLyric；其余方法源码即返回空，沿用基类默认。
 * 播放走后端 getUrl（platform=joox, musicId=mid）——不覆写 resolveMediaInfo。
 *
 * TODO(繁→简)：源码 decodeB64/getLyric 末尾统一过 ChineseConverter.toSimplified，
 *   桌面端尚未接入 OpenCC，标题/歌手/歌词暂保持港区繁体（见 item.ts decodeB64 注释）。
 */
import {
  EMPTY_LYRIC,
  type JooxMusicItem,
  type Lyric,
  type MusicItem,
  type MusicListResult
} from '@common'
import { BaseProvider } from '../base'
import { requestJson } from '../../net/request'
import { decryptQrc, parseTxQrc } from '../../crypto/lyric'
import { jooxTrackUrl } from './sign'
import { num, parseSongInfo } from './item'

const SEARCH_URL = 'http://avatar.api.joox.com/commonCgi/search/get'

/**
 * 注意：不能手动带 Referer——Electron 网络栈（Chromium）按 referrer policy 校验
 * 手动设置的 Referer，此接口为 http:// 目标（https Referer 属降级）会被拒为
 * net::ERR_BLOCKED_BY_CLIENT。实测 JOOX 该接口不校验 Referer，不带即可正常返回。
 */

/** 搜索固定 header 块（逐字对应 JooxProvider.kt:62-86，注意字符串/数字类型区分） */
function searchHeader(): Record<string, unknown> {
  return {
    iUid: '0',
    iSid: '0',
    iCv: 671154790,
    sPhoneType: 'Android-M2012K11AC',
    sOpenUdid: 'fffffffffda6788700000192e18d016e',
    iMcc: '65535',
    iMnc: '65535',
    sCountry: 'HK',
    sLang: 'zh_CN',
    iWmid: '334619483',
    iChid: '000',
    sBackendCountry: 'hk',
    iUserType: 2,
    sOsVer: '33',
    sSkey: '',
    iNetType: 1,
    iMlid: '0',
    iVip: 1,
    iVvip: 1,
    iAppStoreChannel: 0,
    iTerminalType: 1,
    sAppid: '1000716',
    sDebugInfo: ''
  }
}

export class JooxProvider extends BaseProvider {
  readonly source = 'joox' as const
  readonly displayName = 'JOOX'

  async search(keyword: string, page = 0, size = 20): Promise<MusicListResult> {
    const sin = page * size
    const body = {
      header: searchHeader(),
      type: 0,
      keyword,
      keyword_source: 0,
      search_id: '2312821361563828',
      sin,
      ein: size,
      search_channel: '',
      nqc_flag: 0,
      custom_params: { ambi_data: '' }
    }
    const json = await requestJson<any>(SEARCH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body
    }).catch(() => null)

    const sum = num(json?.sum, 0)
    const aggs = json?.song_aggregation_list
    if (!Array.isArray(aggs) || aggs.length === 0) return this.emptyList(page, size)

    const result: JooxMusicItem[] = []
    for (const agg of aggs) {
      const itemList = agg?.item_list
      if (!Array.isArray(itemList)) continue
      for (const it of itemList) {
        const parsed = parseSongInfo(it?.song_info)
        if (parsed) result.push(parsed)
      }
    }
    // 源码不去重（勿照抄 QQ 的 Set 去重）
    return { source: 'joox', hasNext: sin + result.length < sum, page, size, result }
  }

  async getLyric(item: MusicItem): Promise<Lyric> {
    if (item.type !== 'joox') return { ...EMPTY_LYRIC }
    // 源码策略1（QQ 逐字歌词回退）依赖 QQ getLyric，待 QQ 歌词移植后再前置。
    return this.fetchJooxLyric(item.id)
  }

  /** 走 track detail 接口：qrc_exist=1 → QRC 解密；否则 lrc_exist=1 → 明文 LRC（均 base64）。 */
  private async fetchJooxLyric(songId: number): Promise<Lyric> {
    const json = await requestJson<any>(jooxTrackUrl(songId)).catch(() => null)
    if (!json) return { ...EMPTY_LYRIC }

    if (num(json.qrc_exist, 0) === 1 && json.qrc_content) {
      // base64 解出来的是十六进制文本
      const hex = Buffer.from(json.qrc_content, 'base64').toString('utf-8')
      if (hex) {
        const { lrc, char } = parseTxQrc(decryptQrc(hex))
        if (lrc) {
          return { ...EMPTY_LYRIC, lrc, char }
        }
        // 兜底：qrc_content 实为明文 LRC 的 base64
        if (/^\[\d{1,2}:\d{1,2}[.:]\d{1,3}\]/m.test(hex)) {
          return { ...EMPTY_LYRIC, lrc: hex }
        }
      }
    }

    if (num(json.lrc_exist, 0) === 1 && json.lrc_content) {
      const text = Buffer.from(json.lrc_content, 'base64').toString('utf-8')
      if (text) return { ...EMPTY_LYRIC, lrc: text }
    }

    return { ...EMPTY_LYRIC }
  }
}
