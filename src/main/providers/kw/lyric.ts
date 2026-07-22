/** 酷我歌词：buildKuwoParams → newlyric 接口 → 解密 → 三轨（行级 + 逐字 + 翻译） */
import { EMPTY_LYRIC, type Lyric } from '@common'
import { requestBuffer } from '../../net/request'
import { buildKuwoParams, decryptKuwo, parseKuwo } from '../../crypto/lyric'

export async function getKwLyric(id: number): Promise<Lyric> {
  const params = buildKuwoParams(String(id))
  const bytes = await requestBuffer(`http://newlyric.kuwo.cn/newlyric.lrc?${params}`).catch(
    () => null
  )
  if (!bytes || !bytes.length) return { ...EMPTY_LYRIC }
  const { lrc, char, trans } = parseKuwo(decryptKuwo(bytes))
  if (!lrc && !char) return { ...EMPTY_LYRIC }
  return { lrc, trans, roma: '', char, chroma: '', phonetic: '' }
}
