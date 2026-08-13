/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 酷我歌词：info 接口探测音译 → mlyric 接口 → 解密(UTF-8) → 五轨（行级 + 逐字 + 翻译 + 行级音译 + 逐字音译）。
 *
 * 新接口 `mlyric.kuwo.cn/mobi.s`（抓包自 kwplayer_ar_12.1.8.2_18.apk）：
 * - 必须带 `encvCookies` 头，否则风控。
 * - 不带 `trans_type`：对「有翻译的歌」内联中文翻译行；带 `trans_type=roma` 时翻译被音译替换，
 *   因此**翻译与音译需各取一个响应再合并**（见 getKwLyric）。
 * - 无音译的歌带 `trans_type=roma` 会返回 `TP=none`，故先用 `mobilebasedata.kuwo.cn/api/music/info`
 *   探测 `lrc_info.lrc_roma / lrcx_roma`，有音译才请求音译版。
 * - 响应体为 UTF-8（`encode=utf8`），与旧接口的 GB18030 不同。
 */
import { EMPTY_LYRIC, type Lyric } from '@common'
import { requestBuffer, requestJson } from '../../net/request'
import { decryptKuwo, parseKuwo } from '../../crypto/lyric'
import { kuwoEncryptBase64 } from '../../crypto/kuwoDes'

const ANDROID_UA = 'Dalvik/2.1.0 (Linux; U; Android 16; PJF110 Build/UKQ1.231108.001)'
/** mlyric 接口必需的 encvCookies 头（base64 + URL 编码，逐字照抄抓包值） */
const ENCV_COOKIES =
  'HgYSHWIECwZoWQYcWhBBCmZTCFQ5RwYNVkRGQzwTU1JtWl1LRxYfBjtYX1tzBBYmHRAFUmxTQg06HAEcHRwUCjMAGAYzVlFJRyQ%2BIhosXVViWFYcChBFXm0EWwY9XVIdXkITXT0BC1RoWlVJW0QTDG4EXFNsRxEUDjQHHxYhUwgoGwkYEhAFQzMKCQoxPgwdVkdPXWpcVldnU0kVBBIeAQwMCl5uW1xNWEBCX2lcQg06HxEAGxBKOBYjJ08%2BGxUsAhFKXWdcW1tpWlVKU1kFADJYIQ06OwkMGFBFKQ8vKFJuW0BLLTonWhwjLC9u'
const USER = 'aee72ce1e6e96f7f'
const ANDROID_ID = 'aee72ce1e6e96f7f'
const SOURCE = 'kwplayer_ar_12.1.8.2_18.apk'

/** info 接口 `q` 参数明文的固定前缀（q = base64(DES 加密(整串))，见 kuwoDes.ts） */
const INFO_PARAMS =
  'source=kwplayer_ar_12.1.8.2_18.apk&prod=kwplayer_ar_12.1.8.2&platform=ar&uid=2895861038' +
  '&corp=kuwo&approval=false&q36=33eae212a5eb67d57d2bde7710001dc1a203&vipver=12.1.8.2'

function buildLyricUrl(id: number, withRoma: boolean): string {
  const base =
    `http://mlyric.kuwo.cn/mobi.s?f=web&user=${USER}&android_id=${ANDROID_ID}&source=${SOURCE}` +
    `&type=lyric&req=2&lrcx=1&rid=${id}&encode=utf8`
  return withRoma ? `${base}&trans_type=roma` : base
}

/** 探测该曲是否有行级/逐字音译（lrc_roma / lrcx_roma）。探测失败按无音译处理，避免触发 TP=none。 */
async function hasKuwoRoma(id: number): Promise<boolean> {
  const q = kuwoEncryptBase64(`${INFO_PARAMS}&id=${id}`)
  try {
    const json = await requestJson<any>(
      `https://mobilebasedata.kuwo.cn/api/music/info?f=kuwo&q=${encodeURIComponent(q)}`,
      { headers: { 'User-Agent': ANDROID_UA } }
    )
    const li = json?.data?.lrc_info
    return !!(li && (li.lrc_roma || li.lrcx_roma))
  } catch {
    return false
  }
}

/** 拉取并解析歌词；`TP=none`（无音译误请求）或解密失败返回 null。 */
async function fetchKwLyric(id: number, withRoma: boolean): Promise<Lyric | null> {
  const bytes = await requestBuffer(buildLyricUrl(id, withRoma), {
    headers: { 'User-Agent': ANDROID_UA, encvCookies: ENCV_COOKIES }
  }).catch(() => null)
  if (!bytes || !bytes.length) return null
  const text = decryptKuwo(bytes, 'utf-8')
  if (!text) return null
  const { lrc, char, trans, roma, chroma } = parseKuwo(text)
  if (!lrc && !char) return null
  return { lrc, trans, roma, char, chroma, phonetic: '' }
}

export async function getKwLyric(id: number): Promise<Lyric> {
  const withRoma = await hasKuwoRoma(id)
  // 基本版（不带 trans_type）：主歌词 + 翻译（有翻译的歌）
  const base = await fetchKwLyric(id, false)
  if (!base) {
    // 基本版拿不到（风控/TP=none）→ 若探测有音译，试音译版兜底
    if (withRoma) {
      const romaVer = await fetchKwLyric(id, true)
      if (romaVer) return romaVer
    }
    return { ...EMPTY_LYRIC }
  }
  if (!withRoma) return base
  // 音译版：主歌词 + 行级/逐字音译（无翻译）。两版主歌词内容一致（偶差空尾行，
  // 渲染端 realignByIndex 行数不等时按时间就近吸附，空行忽略），可按下标合并。
  const romaVer = await fetchKwLyric(id, true)
  if (!romaVer) return base
  return {
    lrc: romaVer.lrc || base.lrc,
    char: romaVer.char || base.char,
    trans: base.trans || romaVer.trans,
    roma: romaVer.roma,
    chroma: romaVer.chroma,
    phonetic: ''
  }
}
