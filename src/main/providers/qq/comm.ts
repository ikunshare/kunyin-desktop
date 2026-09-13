/**
 * QQ 音乐请求 `comm` 的统一构造（对照后端 internal/platform/tencent/comm.go）。
 *
 * 后端只有一个 `BuildComm(userInfo)`：固定应用字段 + 设备指纹 + 登录态，所有接口共用。
 * 桌面端此前把 comm 散在 13 处（authComm / stdComm / wkComm 与十余处内联字面量），
 * 同样的 `ct/cv/tmeAppID/guid` 抄了一遍又一遍，改个版本号要翻遍整个文件。这里收成
 * 「一张接口族预设表 + 一个构造函数」，调用方只写族名与自己那一次的差异字段。
 *
 * 与后端的差异：后端业务接口走 JCE + AppSign/mask，能统一成一套 `ct=11 cv=20040008`；
 * 桌面端走 musics.fcg + zzc 签名（见 sign.ts），各族的 ct/cv/platform 是各自实测可用的
 * 客户端版本号，混用会让接口只回空数据而不报错，因此保留「族」的概念，只消除重复。
 */
import { ensureQimeiReady, getQQDevice } from './device'

/**
 * 凭据的松散形状：既接 Provider 的 `ProviderCredentials`（带索引签名、值为 unknown），
 * 也接上报模块的 `QQReportCreds`（字段收紧为 string），取值时在内部归一。
 */
export interface QQCommCreds {
  uin?: unknown
  authst?: unknown
  [key: string]: unknown
}

/** 搜索族与 wk_v17 族要带的固定 guid（与 Android 端、lx-music 一致） */
const GUID = '1F70E520B2EAA7D25E11760783C53CA9'

/**
 * 登录方式：微信 → 1，其余非空凭据 → 2（QQ），未登录 → 0。
 * 对齐后端 cookieLoginType；比「只认 Q_H_L 前缀」宽松，换了前缀的新版凭据也能判对。
 */
export function qqLoginType(authst?: string | null): number {
  if (!authst) return 0
  if (authst.startsWith('W_X_')) return 1
  return 2
}

/**
 * 后端 BuildComm 里的设备指纹段。QIMEI 未就绪时给空串并在后台补齐，不阻塞请求
 * （后端是同步阻塞取，桌面端不值得为此拖慢每次调用）。
 */
function deviceFields(): Record<string, unknown> {
  const dev = getQQDevice()
  if (!dev.qimei?.q36) void ensureQimeiReady().catch(() => {})
  return {
    QIMEI: dev.qimei?.q16 ?? '',
    QIMEI36: dev.qimei?.q36 ?? '',
    OpenUDID: dev.open_udid2,
    udid: dev.open_udid2,
    os_ver: dev.version.release,
    aid: dev.android_id,
    phonetype: dev.model,
    devicelevel: dev.version.sdk,
    newdevicelevel: dev.version.sdk,
    nettype: '1030',
    rom: dev.fingerprint,
    OpenUDID2: dev.open_udid2,
    MValue: dev.m_value
  }
}

interface CommPreset {
  /** 该族的固定应用字段 */
  fields: Record<string, unknown>
  /** 叠加设备指纹段（上报链路必需） */
  device?: boolean
  /** 带固定 guid */
  guid?: boolean
  /** 登录后附带 tmeLoginType（由凭据推导；仅后端 BuildComm 等价族需要） */
  loginType?: boolean
}

/**
 * 各接口族的固定字段。ct/cv 是接口认的客户端版本号，改动前务必实测：
 * 同一个 module 换了 cv 可能只回空数据而不报错。
 */
const PRESETS = {
  /**
   * PC 客户端搜索（music.search.SearchCgiService）：单曲 / 歌手共用。
   * 单曲那一路还会额外带一组空的 psrf_* 占位令牌，见 search() 的 extra。
   */
  search: {
    fields: {
      _channelid: '0',
      _os_version: '6.2.9200-2',
      ct: '19',
      cv: '2151',
      patch: '118',
      tmeAppID: 'qqmusic',
      wid: '7223299733393904640'
    },
    guid: true
  },
  /** PC 客户端搜索：专辑（cv / wid 与单曲族不同） */
  searchAlbum: {
    fields: {
      _channelid: '0',
      _os_version: '6.2.9200-2',
      ct: '19',
      cv: '2111',
      patch: '118',
      psrf_access_token_expiresAt: 0,
      psrf_qqaccess_token: '',
      psrf_qqopenid: '',
      psrf_qqunionid: '',
      tmeAppID: 'qqmusic',
      tmeLoginType: 0,
      wid: '7192224010323313664'
    },
    guid: true
  },
  /** 音乐资产族：歌单详情 / 用户主页 / 我的歌单 */
  asset: {
    fields: { ct: '11', cv: '14090508', v: '14090508', tmeAppID: 'qqmusic', uin: '0', authst: '' }
  },
  /** wk_v17 族：歌手详情 / 歌手专辑 / 歌手 MV */
  wk: {
    fields: { format: 'json', ct: 20, cv: 2151, platform: 'wk_v17', uid: '6660007954' },
    guid: true
  },
  /** wk_v17 族 + g_tk：歌手单曲列表 */
  wkSongs: {
    fields: {
      g_tk: 5381,
      uin: 0,
      format: 'json',
      ct: 20,
      cv: 2151,
      platform: 'wk_v17',
      uid: '6660007954'
    },
    guid: true
  },
  /** wk_v17 族 + g_tk：专辑详情与曲目（cv 2111） */
  wkAlbum: {
    fields: {
      g_tk: 5381,
      uin: 0,
      format: 'json',
      ct: 20,
      cv: 2111,
      platform: 'wk_v17',
      uid: '6660007954'
    },
    guid: true
  },
  /** 热搜词（tencent_musicsoso_hotkey） */
  hotkey: { fields: { ct: 19, cv: 1803, uin: 0 } },
  /** 搜索联想词（smartbox） */
  smartbox: { fields: { ct: 20, cv: 1859, uin: '0', format: 'json', platform: 'yqq' } },
  /** 单曲详情（pf_song_detail_svr） */
  songDetail: { fields: { ct: '19', cv: '1859', uin: '0' } },
  /** 歌词（musichallSong.PlayLyricInfo） */
  lyric: { fields: { ct: 19, cv: 1, uin: 0 } },
  /** MV 取流（qqmusiclight） */
  mv: {
    fields: { ct: 11, cv: '21030600', v: '1003006', tmeAppID: 'qqmusiclight', tmeLoginType: '2' }
  },
  /** 发现页：排行榜 / 歌单分类 / 歌单广场 / 歌单搜索 */
  discover: { fields: { ct: 20, cv: 1859, format: 'json', uin: 0 } },
  /** 扫码登录 / 凭据刷新（musicu.fcg 无签名） */
  login: {
    fields: {
      ct: '11',
      cv: '13020508',
      v: '13020508',
      tmeAppID: 'qqmusic',
      format: 'json',
      inCharset: 'utf-8',
      outCharset: 'utf-8'
    }
  },
  /** 听歌上报：等价于后端 BuildComm（固定应用字段 + 设备指纹 + 登录态） */
  report: {
    fields: {
      tyt_exp_env: '0',
      v: '20040008',
      ct: '11',
      cv: '20040008',
      chid: '2005000982',
      tmeAppID: 'qqmusic'
    },
    device: true,
    loginType: true
  }
} satisfies Record<string, CommPreset>

export type QQCommFamily = keyof typeof PRESETS

/**
 * 构造某一族的 comm。
 *
 * 合并顺序：族固定字段 → guid → 设备段 → 调用方 extra → 登录态。
 * 登录态**排在最后**，这一点很重要：预设与 extra 里带的是未登录时的占位
 * `uin: '0'`，登录后必须被真实 uin 覆盖，否则接口按未登录处理（会员/个性化结果丢失）。
 */
export function qqComm(
  family: QQCommFamily,
  creds?: QQCommCreds | null,
  extra?: Record<string, unknown>
): Record<string, unknown> {
  const preset: CommPreset = PRESETS[family]
  const uin =
    typeof creds?.uin === 'string' || typeof creds?.uin === 'number' ? String(creds.uin) : ''
  const authst = typeof creds?.authst === 'string' ? creds.authst : ''
  const login: Record<string, unknown> =
    uin && authst
      ? { uin, authst, ...(preset.loginType ? { tmeLoginType: qqLoginType(authst) } : {}) }
      : {}
  return {
    ...preset.fields,
    ...(preset.guid ? { guid: GUID } : {}),
    ...(preset.device ? deviceFields() : {}),
    ...extra,
    ...login
  }
}
