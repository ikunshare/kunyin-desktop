/** JOOX 歌词/详情接口签名（MD5(salt + 有序参数串)） */
import { createHash } from 'node:crypto'

const SALT = 'Jo0x@t3Nc3nT'

export function jooxTrackUrl(songId: number): string {
  const ordered: Array<[string, string]> = [
    ['country', 'hk'],
    ['lang', 'zh_TW'],
    ['lyric', '1'],
    ['fs', '0'],
    ['im', '0'],
    ['id', String(songId)]
  ]
  const paramStr = ordered.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')
  const secret = createHash('md5')
    .update(SALT + paramStr, 'utf-8')
    .digest('hex')
  const query = `country=hk&lang=zh_TW&lyric=1&fs=0&im=0&secret=${secret}`
  return `https://cache.api.joox.com/openjoox2/v1/track/${songId}?${query}`
}
