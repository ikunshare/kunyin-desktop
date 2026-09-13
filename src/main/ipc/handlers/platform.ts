/**
 * 平台「我的歌单」IPC（对应 Android PlaylistsViewModel 的 PlatformSection 逻辑 +
 * PlaylistViewModel 的平台歌单缓存分支）。
 *
 * - sections：登录平台的用户信息 + 歌单列表，**只读缓存**、立即返回；
 * - refresh：后台刷新某平台——先用户信息、再歌单列表，内容变了的歌单丢掉旧曲目缓存，完成后广播；
 * - songs：某个平台歌单的曲目——有完整缓存直接给；没有就先拉首页立即返回，余页在后台
 *   一页页补齐、逐页推给渲染层，拉齐了才写缓存（对齐 Android「首页 + 静默补齐余页」）；
 * - 跟随凭据变化：新登录的平台立即刷新，登出的平台清缓存（对应 ViewModel 监听 credentials）。
 */
import {
  getMusicItemKey,
  IpcChannels,
  type AccountProvider,
  type MusicItem,
  type PlatformSection,
  type PlatformSongsProgress,
  type PlatformSongsSnapshot
} from '@common'
import { handle, sendToRenderer } from '../helpers'
import { getProvider } from '../../providers'
import { loggedInKeys, onCredentialsChange } from '../../auth/credentials'
import * as store from '../../store/platformPlaylists'
import { appEvent } from '../../core/events'
import { createLogger } from '../../core/logger'

const log = createLogger('platform')

/** 支持歌单同步的平台（Android supportsSyncPlaylist = qq / wy / kg） */
const SYNCABLE: readonly AccountProvider[] = ['qq', 'wy', 'kg']
const DISPLAY: Record<AccountProvider, string> = {
  qq: 'QQ音乐',
  wy: '网易云音乐',
  kg: '酷狗音乐'
}
/** 同一平台两次刷新的最小间隔：列表页每次进入都会触发一次，别把接口打成筛子 */
const REFRESH_MIN_INTERVAL = 60_000
/** 整单拉取的分页大小（kg 侧会封顶到 thirdsso 验证过的 50） */
const PAGE_SIZE = 100
/** 整单拉取的页数上限（kg 封顶 50/页时约 1 万首） */
const MAX_PAGES = 200

const loading = new Set<AccountProvider>()
const lastRefreshAt = new Map<AccountProvider, number>()

/** 一次进行中的整单拉取 */
interface SongsRun {
  source: AccountProvider
  id: string
  runId: number
  /** 按 key 去重的累计曲目（保持到达顺序） */
  songs: Map<string, MusicItem>
  total?: number
  complete: boolean
  error?: string
  /** 被同歌单的「重新拉取」顶掉：拉完当前页就停，不再推送、不落缓存 */
  cancelled: boolean
  /** 首页到手（或首页就失败）后 resolve，songs() 等到这里就返回 */
  first: Promise<void>
}
const runs = new Map<string, SongsRun>()
let runSeq = 0

function syncableLoggedIn(): AccountProvider[] {
  return loggedInKeys().filter((k): k is AccountProvider =>
    (SYNCABLE as readonly string[]).includes(k)
  )
}

function broadcast(): void {
  sendToRenderer(IpcChannels.PLATFORM_CHANGED)
}

export function getSections(): PlatformSection[] {
  return syncableLoggedIn().map((source) => ({
    source,
    displayName: DISPLAY[source],
    userInfo: store.getUserInfo(source),
    playlists: store.getPlaylists(source),
    loading: loading.has(source)
  }))
}

/**
 * 刷新某平台（对应 PlaylistsViewModel.refreshPlatform）：失败保留已有缓存，只停掉 loading。
 * 歌单列表到手后，与旧列表比对：消失或曲目数变化的歌单，其曲目缓存作废。
 */
export async function refreshPlatform(source: AccountProvider, force = false): Promise<void> {
  if (loading.has(source)) return
  if (!force && Date.now() - (lastRefreshAt.get(source) ?? 0) < REFRESH_MIN_INTERVAL) return
  const provider = getProvider(source)
  if (!provider) return

  loading.add(source)
  broadcast()
  try {
    const userInfo = await provider.getUserInfo().catch(() => null)
    if (userInfo) {
      store.saveUserInfo(source, userInfo)
      // 账号页显示的昵称/头像读的就是这份缓存
      sendToRenderer(IpcChannels.ACCOUNT_CHANGED)
    }

    const playlists = await provider.getUserPlaylist()
    const next = new Map(playlists.map((p) => [p.id, p]))
    for (const old of store.getPlaylists(source)) {
      const cur = next.get(old.id)
      if (!cur || cur.total !== old.total) store.clearPlaylistSongs(source, old.id)
    }
    store.savePlaylists(source, playlists)
    lastRefreshAt.set(source, Date.now())
  } catch (e) {
    log.warn('刷新平台歌单失败', { source, error: e })
  } finally {
    loading.delete(source)
    broadcast()
  }
}

export async function refreshAll(force = false): Promise<void> {
  await Promise.all(syncableLoggedIn().map((s) => refreshPlatform(s, force)))
}

const runKey = (source: AccountProvider, id: string): string => `${source}:${id}`

function snapshotOf(run: SongsRun): PlatformSongsSnapshot {
  return {
    source: run.source,
    id: run.id,
    runId: run.runId,
    songs: [...run.songs.values()],
    total: run.total,
    complete: run.complete,
    error: run.error
  }
}

function pushProgress(run: SongsRun, added: MusicItem[]): void {
  if (run.cancelled) return
  const progress: PlatformSongsProgress = {
    source: run.source,
    id: run.id,
    runId: run.runId,
    added,
    loaded: run.songs.size,
    total: run.total,
    complete: run.complete,
    error: run.error
  }
  sendToRenderer(IpcChannels.PLATFORM_SONGS_PROGRESS, progress)
}

/**
 * 拉齐后落缓存（Android 也是「全部加载完毕时才缓存」）：中途出错的残缺列表照常给界面，但不落盘。
 * 下架/本地曲目会被过滤，允许少量缺口（10% 且至少 5 首），与 playlist-refresh 的判定一致。
 */
function finishRun(run: SongsRun): void {
  if (run.cancelled || run.error || !run.songs.size) return
  const songs = [...run.songs.values()]
  const info = store.getPlaylists(run.source).find((p) => p.id === run.id)
  const expected = info?.total ?? run.total ?? 0
  const complete = !expected || songs.length + Math.max(5, Math.ceil(expected * 0.1)) >= expected
  if (!complete) {
    log.warn('平台歌单未拉齐，不落缓存', {
      key: runKey(run.source, run.id),
      expected,
      got: songs.length
    })
    return
  }
  store.saveSongs(run.source, run.id, songs)
  if (info) store.savePlaylistInfo(run.source, run.id, info)
}

/**
 * 启动一次整单拉取：首页到手就 resolve `first`（songs() 据此提前返回），
 * 之后继续在后台一页页补齐，每页经 PLATFORM_SONGS_PROGRESS 推给渲染层。
 */
function startRun(source: AccountProvider, id: string): SongsRun {
  let resolveFirst!: () => void
  const run: SongsRun = {
    source,
    id,
    runId: ++runSeq,
    songs: new Map(),
    complete: false,
    cancelled: false,
    first: new Promise<void>((r) => (resolveFirst = r))
  }
  const key = runKey(source, id)
  runs.set(key, run)

  void (async () => {
    let page = 0
    try {
      const provider = getProvider(source)
      if (!provider) throw new Error('该平台不可用')
      for (; page < MAX_PAGES; page++) {
        const result = await provider.getPlayListSongs(id, page, PAGE_SIZE)
        if (run.cancelled) return
        const before = run.songs.size
        const added: MusicItem[] = []
        for (const item of result.result) {
          const k = getMusicItemKey(item)
          if (run.songs.has(k)) continue
          run.songs.set(k, item)
          added.push(item)
        }
        if (result.total) run.total = result.total
        // 翻页没有新内容：服务端到底了或分页异常，别死循环
        const stalled = result.hasNext && run.songs.size === before
        run.complete = !result.hasNext || stalled
        if (page === 0) resolveFirst()
        else pushProgress(run, added)
        if (run.complete) break
      }
      if (!run.complete) {
        run.complete = true
        run.error = '歌单过大，未完整加载'
        pushProgress(run, [])
      }
      finishRun(run)
    } catch (e) {
      log.warn('拉取平台歌单曲目失败', { key, page, error: e })
      run.error = e instanceof Error ? e.message : '歌单加载失败'
      run.complete = true
      if (page === 0) resolveFirst()
      else pushProgress(run, [])
    } finally {
      if (runs.get(key) === run) runs.delete(key)
    }
  })()
  return run
}

/**
 * 某歌单的曲目。完整缓存命中直接返回；否则返回首页快照（complete=false），
 * 余页由后台补齐并逐页推送。force 忽略缓存重拉，并顶掉同歌单正在进行的拉取。
 */
export async function getSongs(
  source: AccountProvider,
  id: string,
  force = false
): Promise<PlatformSongsSnapshot> {
  if (!force) {
    const cached = store.getSongs(source, id)
    if (cached?.length)
      return { source, id, runId: 0, songs: cached, total: cached.length, complete: true }
  }
  let run = runs.get(runKey(source, id))
  if (run && force) {
    run.cancelled = true
    run = undefined
  }
  run ??= startRun(source, id)
  await run.first
  return snapshotOf(run)
}

export function registerPlatformHandlers(): void {
  handle(IpcChannels.PLATFORM_SECTIONS, (): PlatformSection[] => getSections())
  handle(IpcChannels.PLATFORM_REFRESH, async (source?: AccountProvider, force?: boolean) => {
    if (source) await refreshPlatform(source, force)
    else await refreshAll(force)
  })
  handle(
    IpcChannels.PLATFORM_SONGS,
    (source: AccountProvider, id: string, force?: boolean): Promise<PlatformSongsSnapshot> =>
      getSongs(source, id, force)
  )

  // 凭据变化：新登录 → 立即刷新；登出 → 清缓存
  let known = new Set(syncableLoggedIn())
  onCredentialsChange(() => {
    const now = new Set(syncableLoggedIn())
    for (const s of now) if (!known.has(s)) void refreshPlatform(s, true)
    for (const s of known) {
      if (now.has(s)) continue
      store.clearPlatform(s)
      lastRefreshAt.delete(s)
    }
    known = now
    broadcast()
  })

  // 启动后刷新一轮：排在 scheduleLoginRefresh（5s）之后，让酷狗先把 token 换好
  appEvent.on('app-inited', () => {
    setTimeout(() => void refreshAll(), 8000).unref()
  })
}
