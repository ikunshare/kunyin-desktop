/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 平台发现（排行榜 / 热门歌单 / 歌单分类 / 歌单搜索）。
 * 接口与参数移植自 LX musicSdk 各平台的 leaderboard.js / songList.js，返回本项目统一 DTO。
 *
 * 榜单列表对齐 LX：kg / kw 用固定榜单表；wy / qq 先走线上接口，失败回落固定表。
 * 列表类结果带短 TTL 内存缓存并合并并发请求，切换平台/榜单来回点不会反复打接口。
 */
import {
  DISCOVER_SOURCES,
  PLAYLIST_SORTS,
  type ChartInfo,
  type KugouMusicItem,
  type KuwoMusicItem,
  type MusicListResult,
  type MusicSource,
  type PlaylistCategory,
  type PlaylistSearchResult,
  type PlayListInfoResult
} from '@common'
import { eapiPost, weapiPost } from '../crypto/netease'
import { requestJson, requestText } from '../net/request'
import { zzcRequest } from './qq'
import { qqComm } from './qq/comm'
import { parseTrackInfo } from './qq/item'
import { parseKgRankSong } from './kg/item'
import { parseKwListSong } from './kw/item'
import { wbdBuildParam, wbdDecode } from './kw/wbd'
import { getProvider } from './index'
import type { KgProvider } from './kg'
import type { KwProvider } from './kw'

// ============ 通用工具 ============

const MINUTE = 60 * 1000
const memo = new Map<string, { at: number; value: unknown }>()
const inflight = new Map<string, Promise<unknown>>()
const MEMO_LIMIT = 400

/** TTL 内存缓存 + 并发合并；失败不缓存。条目超上限时淘汰最早写入的一半。 */
function cached<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
  const hit = memo.get(key)
  if (hit && Date.now() - hit.at < ttl) return Promise.resolve(hit.value as T)
  const pending = inflight.get(key)
  if (pending) return pending as Promise<T>
  const task = load()
    .then((value) => {
      if (memo.size >= MEMO_LIMIT) {
        for (const k of [...memo.keys()].slice(0, MEMO_LIMIT / 2)) memo.delete(k)
      }
      memo.delete(key)
      memo.set(key, { at: Date.now(), value })
      return value
    })
    .finally(() => inflight.delete(key))
  inflight.set(key, task)
  return task
}

/** 最多重试 times 次，回调返回 null / 抛错都视为失败 */
async function retry<T>(times: number, fn: () => Promise<T | null>): Promise<T | null> {
  for (let i = 0; i < times; i++) {
    const value = await fn().catch(() => null)
    if (value != null) return value
  }
  return null
}

function clean(value: unknown): string {
  return String(value ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim()
}

/** 「1.2万」「3亿」「12345」→ 数字 */
function parseCount(value: unknown): number {
  if (value == null || value === '') return 0
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  const s = String(value).trim()
  const m = /^([\d.]+)\s*(亿|万|w|W)?/.exec(s)
  if (!m) return 0
  const n = Number(m[1])
  if (!Number.isFinite(n)) return 0
  if (m[2] === '亿') return Math.round(n * 1e8)
  if (m[2]) return Math.round(n * 1e4)
  return Math.round(n)
}

function checkSource(source: MusicSource): void {
  if (!DISCOVER_SOURCES.includes(source)) throw new Error('该平台暂不支持发现功能')
}
function clampPage(page: number): number {
  return Math.max(0, Math.trunc(page) || 0)
}
function clampSize(size: number, max: number): number {
  return Math.max(1, Math.min(max, Math.trunc(size) || 1))
}
function fail(source: MusicSource): never {
  const names: Partial<Record<MusicSource, string>> = {
    wy: '网易云',
    qq: 'QQ 音乐',
    kg: '酷狗',
    kw: '酷我'
  }
  throw new Error(`${names[source] ?? '该平台'}暂时无法返回数据，请稍后重试`)
}

// ============ 网易云 ============

function checkWy(json: any): void {
  if (json?.code !== 200) throw new Error('网易云暂时无法返回数据，请稍后重试')
}
function wyPlaylist(p: any): PlayListInfoResult {
  return {
    source: 'wy',
    id: String(p.id),
    name: clean(p.name),
    cover: p.coverImgUrl,
    creator: clean(p.creator?.nickname),
    description: clean(p.description),
    total: Number(p.trackCount) || undefined,
    playCount: Number(p.playCount) || 0
  }
}

// ============ QQ 音乐 ============

function qqPlaylist(p: any): PlayListInfoResult {
  return {
    source: 'qq',
    id: String(p.tid ?? p.dissid ?? p.diss_id),
    name: clean(p.title ?? p.dissname ?? p.diss_name),
    cover: p.cover_url_medium ?? p.imgurl ?? p.logo ?? p.cover?.medium_url,
    creator: clean(p.creator_info?.nick ?? p.creator?.nick ?? p.creator?.name ?? p.nickname),
    description: clean(p.desc ?? p.introduction),
    total: Number(p.song_count ?? p.songnum) || undefined,
    playCount: Number(p.access_num ?? p.play_cnt ?? p.listennum ?? p.listen_num) || 0
  }
}
async function qqCall(
  module: string,
  method: string,
  param: Record<string, unknown>
): Promise<any> {
  const json = await zzcRequest({
    comm: qqComm('discover'),
    req: { module, method, param }
  })
  if (json?.req?.code !== 0 || !json.req.data)
    throw new Error('QQ 音乐暂时无法返回数据，请稍后重试')
  return json.req.data
}
/** LX：去掉「巅峰榜·」前缀并补「榜」 */
function qqBoardName(raw: unknown): string {
  let name = clean(raw).replace(/^巅峰榜·/, '')
  if (name && !name.endsWith('榜')) name += '榜'
  return name
}

// ============ 酷狗 ============

const KG_ROOT = 'http://www2.kugou.kugou.com/yueku/v9/special/getSpecial'

function kgPlaylist(p: any): PlayListInfoResult {
  const specialId = p.specialid ?? p.special_id ?? p.id
  return {
    source: 'kg',
    id: `id_${specialId}`,
    name: clean(p.specialname ?? p.special_name ?? p.name),
    cover: p.img || p.imgurl || p.pic || undefined,
    creator: clean(p.nickname ?? p.username),
    description: clean(p.intro),
    total: Number(p.songcount ?? p.song_count) || undefined,
    playCount: parseCount(p.play_count) || parseCount(p.total_play_count)
  }
}

// ============ 酷我 ============

const KW_BASE = 'http://wapi.kuwo.cn/api/pc/classify/playlist'
const KW_AUTH = 'loginUid=0&loginSid=0&appUid=76039576'

function kwPlaylist(p: any): PlayListInfoResult {
  return {
    source: 'kw',
    id: `digest-${p.digest ?? 8}__${p.id}`,
    name: clean(p.name),
    cover: p.img || p.pic || undefined,
    creator: clean(p.uname),
    description: clean(p.desc ?? p.info),
    total: Number(p.total) || undefined,
    playCount: parseCount(p.listencnt ?? p.play_count)
  }
}

// ============ 固定榜单表（取自 LX 各平台 leaderboard.js） ============

type Board = [id: string, name: string]

function boards(source: MusicSource, list: Board[]): ChartInfo[] {
  return list.map(([id, name]) => ({ source, id, name }))
}

const WY_BOARDS: Board[] = [
  ['19723756', '飙升榜'],
  ['3779629', '新歌榜'],
  ['2884035', '原创榜'],
  ['3778678', '热歌榜'],
  ['991319590', '说唱榜'],
  ['71384707', '古典榜'],
  ['1978921795', '电音榜'],
  ['5453912201', '黑胶VIP爱听榜'],
  ['71385702', 'ACG榜'],
  ['745956260', '韩语榜'],
  ['10520166', '国电榜'],
  ['180106', 'UK排行榜周榜'],
  ['60198', '美国Billboard榜'],
  ['3812895', 'Beatport全球电子舞曲榜'],
  ['21845217', 'KTV唛榜'],
  ['60131', '日本Oricon榜'],
  ['2809513713', '欧美热歌榜'],
  ['2809577409', '欧美新歌榜'],
  ['27135204', '法国 NRJ Vos Hits 周榜'],
  ['3001835560', 'ACG动画榜'],
  ['3001795926', 'ACG游戏榜'],
  ['3001890046', 'ACG VOCALOID榜'],
  ['3112516681', '中国新乡村音乐排行榜'],
  ['5059644681', '日语榜'],
  ['5059633707', '摇滚榜'],
  ['5059642708', '国风榜'],
  ['5338990334', '潜力爆款榜'],
  ['5059661515', '民谣榜'],
  ['6688069460', '听歌识曲榜'],
  ['6723173524', '网络热歌榜'],
  ['6732051320', '俄语榜'],
  ['6732014811', '越南语榜'],
  ['6886768100', '中文DJ榜'],
  ['6939992364', '俄罗斯top hit流行音乐榜'],
  ['7095271308', '泰语榜'],
  ['7356827205', 'BEAT排行榜'],
  ['7603212484', 'LOOK直播歌曲榜'],
  ['7775163417', '赏音榜'],
  ['7785123708', '黑胶VIP新歌榜'],
  ['7785066739', '黑胶VIP热歌榜'],
  ['7785091694', '黑胶VIP爱搜榜']
]

const QQ_BOARDS: Board[] = [
  ['4', '流行指数榜'],
  ['26', '热歌榜'],
  ['27', '新歌榜'],
  ['62', '飙升榜'],
  ['58', '说唱榜'],
  ['57', '喜力电音榜'],
  ['28', '网络歌曲榜'],
  ['5', '内地榜'],
  ['3', '欧美榜'],
  ['59', '香港地区榜'],
  ['16', '韩国榜'],
  ['60', '抖快榜'],
  ['29', '影视金曲榜'],
  ['17', '日本榜'],
  ['52', '腾讯音乐人原创榜'],
  ['36', 'K歌金曲榜'],
  ['61', '台湾地区榜'],
  ['63', 'DJ舞曲榜'],
  ['64', '综艺新歌榜'],
  ['65', '国风热歌榜'],
  ['67', '听歌识曲榜'],
  ['72', '动漫音乐榜'],
  ['73', '游戏音乐榜'],
  ['75', '有声榜'],
  ['131', '校园音乐人排行榜']
]

const KG_BOARDS: Board[] = [
  ['8888', 'TOP500'],
  ['6666', '飙升榜'],
  ['59703', '蜂鸟流行音乐榜'],
  ['52144', '抖音热歌榜'],
  ['52767', '快手热歌榜'],
  ['24971', 'DJ热歌榜'],
  ['23784', '网络红歌榜'],
  ['44412', '说唱先锋榜'],
  ['31308', '内地榜'],
  ['33160', '电音榜'],
  ['31313', '香港地区榜'],
  ['51341', '民谣榜'],
  ['54848', '台湾地区榜'],
  ['31310', '欧美榜'],
  ['33162', 'ACG新歌榜'],
  ['31311', '韩国榜'],
  ['31312', '日本榜'],
  ['49225', '80后热歌榜'],
  ['49223', '90后热歌榜'],
  ['49224', '00后热歌榜'],
  ['33165', '粤语金曲榜'],
  ['33166', '欧美金曲榜'],
  ['33163', '影视金曲榜'],
  ['51340', '伤感榜'],
  ['35811', '会员专享榜'],
  ['37361', '雷达榜'],
  ['21101', '分享榜'],
  ['46910', '综艺新歌榜'],
  ['30972', '酷狗音乐人原创榜'],
  ['60170', '闽南语榜'],
  ['65234', '儿歌榜'],
  ['4681', '美国BillBoard榜'],
  ['25028', 'Beatport电子舞曲榜'],
  ['4680', '英国单曲榜'],
  ['38623', '韩国Melon音乐榜'],
  ['42807', 'joox本地热歌榜'],
  ['36107', '小语种热歌榜'],
  ['4673', '日本公信榜'],
  ['46868', '日本SPACE SHOWER榜'],
  ['42808', 'KKBOX风云榜'],
  ['60171', '越南语榜'],
  ['60172', '泰语榜'],
  ['59895', 'R&B榜'],
  ['59896', '摇滚榜'],
  ['59897', '爵士榜'],
  ['59898', '乡村音乐榜'],
  ['59900', '纯音乐榜'],
  ['59899', '古典榜'],
  ['22603', '5sing音乐榜'],
  ['21335', '繁星音乐榜'],
  ['33161', '古风新歌榜']
]

const KW_BOARDS: Board[] = [
  ['93', '飙升榜'],
  ['17', '新歌榜'],
  ['16', '热歌榜'],
  ['158', '抖音热歌榜'],
  ['292', '铃声榜'],
  ['284', '热评榜'],
  ['290', 'ACG新歌榜'],
  ['286', '台湾KKBOX榜'],
  ['279', '冬日暖心榜'],
  ['281', '巴士随身听榜'],
  ['255', 'KTV点唱榜'],
  ['280', '家务进行曲榜'],
  ['282', '熬夜修仙榜'],
  ['283', '枕边轻音乐榜'],
  ['278', '古风音乐榜'],
  ['264', 'Vlog音乐榜'],
  ['242', '电音榜'],
  ['187', '流行趋势榜'],
  ['204', '现场音乐榜'],
  ['186', 'ACG神曲榜'],
  ['185', '最强翻唱榜'],
  ['26', '经典怀旧榜'],
  ['104', '华语榜'],
  ['182', '粤语榜'],
  ['22', '欧美榜'],
  ['184', '韩语榜'],
  ['183', '日语榜'],
  ['145', '会员畅听榜'],
  ['153', '网红新歌榜'],
  ['64', '影视金曲榜'],
  ['176', 'DJ嗨歌榜'],
  ['106', '真声音'],
  ['12', 'Billboard榜'],
  ['49', 'iTunes音乐榜'],
  ['180', 'beatport电音榜'],
  ['13', '英国UK榜'],
  ['164', '百大DJ榜'],
  ['246', 'YouTube音乐排行榜'],
  ['265', '韩国Genie榜'],
  ['14', '韩国M-net榜'],
  ['8', '香港电台榜'],
  ['15', '日本公信榜'],
  ['151', '腾讯音乐人原创榜']
]

// ============ 排行榜 ============

export async function getCharts(source: MusicSource): Promise<ChartInfo[]> {
  checkSource(source)
  return cached(`charts:${source}`, 30 * MINUTE, async () => {
    if (source === 'kg') return boards('kg', KG_BOARDS)
    if (source === 'kw') return boards('kw', KW_BOARDS)
    if (source === 'wy') {
      const list = await retry(2, async () => {
        const json = await weapiPost('/api/toplist/detail', {})
        if (json?.code !== 200 || !Array.isArray(json.list) || !json.list.length) return null
        return json.list.map((p: any): ChartInfo => ({
          ...wyPlaylist(p),
          updateFrequency: p.updateFrequency
        }))
      })
      return list ?? boards('wy', WY_BOARDS)
    }
    const list = await retry(2, async () => {
      const data = await qqCall('musicToplist.ToplistInfoServer', 'GetAll', {})
      const out = (data.group ?? []).flatMap((group: any) =>
        (group.toplist ?? [])
          .filter((p: any) => Number(p.topId) !== 201) // MV 榜不是歌曲榜
          .map((p: any): ChartInfo => ({
            source: 'qq',
            id: String(p.topId),
            name: qqBoardName(p.title),
            cover: p.frontPicUrl ?? p.headPicUrl,
            period: p.period,
            updateFrequency: p.updateTime,
            total: p.totalNum
          }))
      )
      return out.length ? out : null
    })
    return list ?? boards('qq', QQ_BOARDS)
  })
}

export async function getChartSongs(
  source: MusicSource,
  id: string,
  page = 0,
  size = 100,
  period = ''
): Promise<MusicListResult> {
  checkSource(source)
  page = clampPage(page)
  size = clampSize(size, 300)
  const key = `chartSongs:${source}:${id}:${page}:${size}:${period}`
  return cached(key, 10 * MINUTE, async () => {
    if (source === 'wy') return getProvider('wy')!.getPlayListSongs(id, page, size)
    if (source === 'qq') {
      const data = await qqCall('musicToplist.ToplistInfoServer', 'GetDetail', {
        topid: Number(id),
        num: size,
        offset: page * size,
        period
      })
      const result = (data.songInfoList ?? []).map(parseTrackInfo).filter(Boolean)
      const total = Number(data.data?.totalNum) || (page === 0 ? result.length : 0)
      return { source, page, size, hasNext: (page + 1) * size < total, total, result }
    }
    if (source === 'kg') {
      const json = await retry(3, async () => {
        const resp = await requestJson<any>(
          `http://mobilecdnbj.kugou.com/api/v3/rank/song?version=9108&ranktype=1&plat=0` +
            `&pagesize=${size}&area_code=1&page=${page + 1}&rankid=${id}&with_res_tag=0&show_portrait_mv=1`
        )
        return resp?.errcode === 0 && resp.data ? resp.data : null
      })
      if (!json) fail(source)
      const items = ((json.info ?? []) as any[])
        .map(parseKgRankSong)
        .filter((x): x is KugouMusicItem => !!x)
      await (getProvider('kg') as KgProvider).fillCovers(items.filter((i) => !i.cover))
      const total = Number(json.total) || items.length
      return { source, page, size, hasNext: (page + 1) * size < total, total, result: items }
    }
    // 酷我：wbd 加密接口（AES-128-ECB）
    const data = await retry(3, async () => {
      const text = await requestText(
        `https://wbd.kuwo.cn/api/bd/bang/bang_info?${wbdBuildParam({
          uid: '',
          devId: '',
          sFrom: 'kuwo_sdk',
          user_type: 'AP',
          carSource: 'kwplayercar_ar_6.0.1.0_apk_keluze.apk',
          id,
          pn: page,
          rn: size
        })}`
      )
      const json = wbdDecode(text)
      return Number(json?.code) === 200 && json.data?.musiclist ? json.data : null
    })
    if (!data) fail(source)
    const items = ((data.musiclist ?? []) as any[])
      .map(parseKwListSong)
      .filter((x): x is KuwoMusicItem => !!x)
    await (getProvider('kw') as KwProvider).fillCovers(items.filter((i) => !i.cover))
    const total = Number(data.total) || items.length
    return { source, page, size, hasNext: (page + 1) * size < total, total, result: items }
  })
}

// ============ 歌单分类 ============

export async function getCategories(source: MusicSource): Promise<PlaylistCategory[]> {
  checkSource(source)
  return cached(`categories:${source}`, 60 * MINUTE, async () => {
    if (source === 'wy') {
      const [catalogue, hot] = await Promise.all([
        weapiPost('/api/playlist/catalogue', {}),
        weapiPost('/api/playlist/hottags', {}).catch(() => null)
      ])
      checkWy(catalogue)
      const hotTags: PlaylistCategory[] = ((hot?.tags ?? []) as any[])
        .map((t) => clean(t?.playlistTag?.name ?? t?.name))
        .filter(Boolean)
        .map((name) => ({ id: name, name, group: '热门' }))
      const all: PlaylistCategory[] = (catalogue.sub ?? []).map((item: any) => ({
        id: item.name,
        name: item.name,
        group: catalogue.categories?.[item.category] ?? '分类'
      }))
      return [...hotTags, ...all]
    }
    if (source === 'qq') {
      const data = await qqCall('playlist.PlaylistAllCategoriesServer', 'get_all_categories', {
        qq: ''
      })
      return (data.v_group ?? []).flatMap((group: any) =>
        (group.v_item ?? []).map((item: any) => ({
          id: String(item.id),
          name: item.name,
          group: group.group_name
        }))
      )
    }
    if (source === 'kg') {
      const data = await retry(3, async () => {
        const json = await requestJson<any>(`${KG_ROOT}?is_smarty=1&`)
        return json?.status === 1 && json.data ? json.data : null
      })
      if (!data) fail(source)
      const out: PlaylistCategory[] = []
      const hot = data.hotTag?.status === 1 ? data.hotTag.data : null
      if (hot) {
        for (const tag of Object.values(hot) as any[]) {
          if (tag?.special_id != null)
            out.push({ id: String(tag.special_id), name: clean(tag.special_name), group: '热门' })
        }
      }
      for (const [group, info] of Object.entries((data.tagids ?? {}) as Record<string, any>)) {
        for (const tag of (info?.data ?? []) as any[]) {
          if (tag?.id != null) out.push({ id: String(tag.id), name: clean(tag.name), group })
        }
      }
      return out
    }
    // 酷我：分类 id 带 digest 后缀（`id-digest`），决定取列表时走哪个接口
    const [tags, hot] = await Promise.all([
      retry(3, async () => {
        const json = await requestJson<any>(
          `${KW_BASE}/getTagList?cmd=rcm_keyword_playlist&user=0&prod=kwplayer_pc_9.0.5.0` +
            `&vipver=9.0.5.0&source=kwplayer_pc_9.0.5.0&${KW_AUTH}`
        )
        return Number(json?.code) === 200 && Array.isArray(json.data) ? json.data : null
      }),
      retry(2, async () => {
        const json = await requestJson<any>(`${KW_BASE}/getRcmTagList?${KW_AUTH}`)
        return Number(json?.code) === 200 ? (json.data?.[0]?.data ?? []) : null
      })
    ])
    if (!tags) fail(source)
    const out: PlaylistCategory[] = ((hot ?? []) as any[]).map((t) => ({
      id: `${t.id}-${t.digest}`,
      name: clean(t.name),
      group: '热门'
    }))
    for (const type of tags as any[]) {
      for (const t of (type?.data ?? []) as any[]) {
        out.push({ id: `${t.id}-${t.digest}`, name: clean(t.name), group: clean(type.name) })
      }
    }
    return out
  })
}

// ============ 热门歌单 ============

/** 酷狗歌单列表的分页参数（pagesize/total）按分类缓存，避免每页都多打一次接口 */
async function kgListInfo(category: string): Promise<{ pagesize: number; total: number }> {
  return cached(`kgListInfo:${category}`, 10 * MINUTE, async () => {
    const url = category
      ? `${KG_ROOT}?is_smarty=1&cdn=cdn&t=5&c=${category}`
      : `${KG_ROOT}?is_smarty=1&`
    const json = await requestJson<any>(url).catch(() => null)
    const params = json?.status === 1 ? json.data?.params : null
    return { pagesize: Number(params?.pagesize) || 0, total: Number(params?.total) || 0 }
  })
}

/** 酷狗「推荐」排序首页顺带的猜你喜欢歌单（失败静默） */
async function kgRecommend(): Promise<PlayListInfoResult[]> {
  return cached('kgRecommend', 10 * MINUTE, async () => {
    const json = await requestJson<any>(
      'http://everydayrec.service.kugou.com/guess_special_recommend',
      {
        method: 'POST',
        headers: { 'User-Agent': 'KuGou2012-8275-web_browser_event_handler' },
        body: {
          appid: 1001,
          clienttime: 1566798337219,
          clientver: 8275,
          key: 'f1f93580115bb106680d2375f8032d96',
          mid: '21511157a05844bd085308bc76ef3343',
          platform: 'pc',
          userid: '262643156',
          return_min: 6,
          return_max: 15
        }
      }
    ).catch(() => null)
    return json?.status === 1 ? ((json.data?.special_list ?? []) as any[]).map(kgPlaylist) : []
  })
}

function defaultSort(source: MusicSource): string {
  return PLAYLIST_SORTS[source]?.[0]?.id ?? 'hot'
}

export async function discoverPlaylists(
  source: MusicSource,
  category: string,
  order: string,
  page = 0,
  size = 30
): Promise<PlaylistSearchResult> {
  checkSource(source)
  page = clampPage(page)
  size = clampSize(size, 50)
  category = String(category ?? '').trim()
  order = String(order ?? '').trim() || defaultSort(source)
  const key = `playlists:${source}:${category}:${order}:${page}:${size}`
  return cached(key, 5 * MINUTE, async () => {
    if (source === 'wy') {
      const json = await weapiPost('/api/playlist/list', {
        cat: category || '全部',
        order: order === 'new' ? 'new' : 'hot',
        limit: size,
        offset: page * size,
        total: true
      })
      checkWy(json)
      const total = Number(json.total) || 0
      return {
        source,
        page,
        size,
        total: total || undefined,
        hasNext: (page + 1) * size < total,
        result: (json.playlists ?? []).map(wyPlaylist)
      }
    }
    if (source === 'qq') {
      // 兼容旧值 hot/new；LX 的排序 id 为 5（最热）/ 2（最新）
      const qqOrder = order === 'new' ? 2 : order === 'hot' ? 5 : Number(order) || 5
      const data = category
        ? await qqCall('playlist.PlayListCategoryServer', 'get_category_content', {
            titleid: Number(category),
            caller: '0',
            category_id: Number(category),
            page,
            size,
            use_page: 1
          })
        : await qqCall('playlist.PlayListPlazaServer', 'get_playlist_by_tag', {
            id: 10000000,
            sin: page * size,
            size,
            order: qqOrder,
            cur_page: page + 1
          })
      const list = category
        ? (data.content?.v_item ?? []).map((item: any) => item.basic)
        : (data.v_playlist ?? [])
      const total = (category ? Number(data.content?.total_cnt) : Number(data.total)) || 0
      return {
        source,
        page,
        size,
        total: total || undefined,
        hasNext: total ? (page + 1) * size < total : list.length === size,
        result: list.map(qqPlaylist)
      }
    }
    if (source === 'kg') {
      const sort = /^\d+$/.test(order) ? order : order === 'new' ? '7' : '6'
      const [listJson, info, recommend] = await Promise.all([
        retry(3, async () => {
          const json = await requestJson<any>(
            `${KG_ROOT}?is_ajax=1&cdn=cdn&t=${sort}&c=${category}&p=${page + 1}`
          )
          return json?.status === 1 && Array.isArray(json.special_db) ? json.special_db : null
        }),
        kgListInfo(category),
        !category && page === 0 && sort === defaultSort('kg') ? kgRecommend() : Promise.resolve([])
      ])
      if (!listJson) fail(source)
      const pageList = (listJson as any[]).map(kgPlaylist)
      const pagesize = info.pagesize || pageList.length
      const hasNext = info.total
        ? (page + 1) * pagesize < info.total
        : pageList.length > 0 && pageList.length >= pagesize
      return {
        source,
        page,
        size: pagesize,
        total: info.total || undefined,
        hasNext,
        result: [...recommend, ...pageList]
      }
    }
    // 酷我
    const [tagId, digest] = category ? category.split('-') : ['', '']
    if (tagId && digest === '43') {
      // 专区页：一次性返回，不分页
      if (page > 0) return { source, page, size, hasNext: false, result: [] }
      const sections = await retry(3, async () => {
        const json = await requestJson<any>(
          `http://mobileinterfaces.kuwo.cn/er.s?type=get_pc_qz_data&f=web&id=${tagId}&prod=pc`
        )
        return Array.isArray(json) && json.length ? json : null
      })
      if (!sections) fail(source)
      const result = (sections as any[])
        .flatMap((s) => (s?.list ?? []) as any[])
        .filter((it) => it?.type === 'songlist' || it?.type === 'list')
        .map(kwPlaylist)
      return { source, page, size, hasNext: false, result }
    }
    const url = tagId
      ? `${KW_BASE}/getTagPlayList?${KW_AUTH}&pn=${page + 1}&id=${tagId}&rn=${size}`
      : `${KW_BASE}/getRcmPlayList?${KW_AUTH}&&pn=${page + 1}&rn=${size}&order=${order === 'new' ? 'new' : 'hot'}`
    const data = await retry(3, async () => {
      const json = await requestJson<any>(url)
      return Number(json?.code) === 200 && json.data ? json.data : null
    })
    if (!data) fail(source)
    const result = ((data.data ?? []) as any[]).map(kwPlaylist)
    const total = Number(data.total) || 0
    return {
      source,
      page,
      size,
      total: total || undefined,
      hasNext: total ? (page + 1) * size < total : result.length >= size,
      result
    }
  })
}

// ============ 歌单搜索 ============

export async function searchPlaylists(
  source: MusicSource,
  keyword: string,
  page = 0,
  size = 20
): Promise<PlaylistSearchResult> {
  if (source !== 'wy' && source !== 'qq') throw new Error('该平台暂不支持歌单搜索')
  page = clampPage(page)
  size = clampSize(size, 50)
  if (source === 'wy') {
    const json = await eapiPost('/api/cloudsearch/pc', {
      s: keyword,
      type: 1000,
      limit: size,
      offset: page * size,
      total: page === 0
    })
    checkWy(json)
    return {
      source,
      page,
      size,
      hasNext: (page + 1) * size < Number(json.result?.playlistCount),
      result: (json.result?.playlists ?? []).map(wyPlaylist)
    }
  }
  const data = await qqCall('music.search.SearchCgiService', 'DoSearchForQQMusicDesktop', {
    grp: 1,
    num_per_page: size,
    page_num: page + 1,
    query: keyword,
    remoteplace: 'txt.newclient.top',
    search_type: 3
  })
  const list = data.body?.songlist?.list ?? data.body?.item_songlist ?? []
  return {
    source,
    page,
    size,
    hasNext: (page + 1) * size < Number(data.meta?.sum),
    result: list.map(qqPlaylist)
  }
}
