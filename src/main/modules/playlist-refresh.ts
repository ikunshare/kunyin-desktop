import { getMusicItemKey, type MusicItem, type MusicSource } from '@common'
import { getProvider } from '../providers'
import { getChartSongs } from '../providers/discovery'
import * as library from '../store/library'
import { appEvent } from '../core/events'

export async function fetchPlaylist(
  source: MusicSource,
  id: string,
  chart = false,
  period = ''
): Promise<MusicItem[]> {
  const provider = getProvider(source)
  if (!provider) throw new Error('不支持的音乐平台')
  const expected = chart ? 0 : ((await provider.getPlayListInfo(id))?.total ?? 0)
  const all = new Map<string, MusicItem>()
  for (let page = 0; page < 100; page++) {
    const result = chart
      ? await getChartSongs(source, id, page, 100, period)
      : await provider.getPlayListSongs(id, page, 100)
    const before = all.size
    for (const item of result.result) all.set(getMusicItemKey(item), item)
    if (!result.result.length && page > 0) throw new Error('歌单未完整返回，已保留原歌单，请重试')
    if (!result.hasNext) {
      if (!all.size) throw new Error('歌单为空或暂时无法访问')
      // 下架/无版权曲目会被解析过滤，允许少量缺口（10% 且至少 5 首）；差距过大才视为分页失败
      if (expected > all.size + Math.max(5, Math.ceil(expected * 0.1)))
        throw new Error('部分歌曲未能加载，已保留原歌单，请重试')
      return [...all.values()]
    }
    if (all.size === before) throw new Error('歌单分页异常，请稍后重试')
  }
  throw new Error('歌单过大，未完整加载，已保留原歌单')
}

const pendingImports = new Map<string, Promise<number>>()
export async function refreshRemotePlaylist(playlistId: number): Promise<number> {
  const playlist = library.getPlaylists().find((item) => item.id === playlistId)
  if (!playlist?.remoteSource || !playlist.remoteId) throw new Error('歌单没有绑定远端来源')
  const songs = await fetchPlaylist(playlist.remoteSource as MusicSource, playlist.remoteId)
  if (!library.getPlaylists().some((item) => item.id === playlistId))
    throw new Error('歌单已被移除')
  library.replacePlaylistSongs(playlistId, songs)
  return songs.length
}
export function importRemotePlaylist(
  source: MusicSource,
  id: string,
  name: string,
  chart = false,
  period = ''
): Promise<number> {
  const key = `${source}:${chart ? 'chart:' : ''}${id}`
  const pending = pendingImports.get(key)
  if (pending) return pending
  const task = (async (): Promise<number> => {
    const existing = !chart ? library.getPlaylistByRemoteId(source, id) : undefined
    if (existing) return existing.id
    const songs = await fetchPlaylist(source, id, chart, period)
    const playlistId = library.createPlaylist(
      name || '收藏的歌单',
      chart ? {} : { remoteSource: source, remoteId: id }
    )
    library.replacePlaylistSongs(playlistId, songs)
    return playlistId
  })().finally(() => pendingImports.delete(key))
  pendingImports.set(key, task)
  return task
}

export function registerPlaylistRefresh(): void {
  appEvent.on('app-inited', () => {
    const timer = setTimeout(() => {
      void (async () => {
        for (const playlist of library
          .getPlaylists()
          .filter((item) => item.autoRefresh && item.remoteId && item.remoteSource)) {
          try {
            const songs = await fetchPlaylist(
              playlist.remoteSource as MusicSource,
              playlist.remoteId!
            )
            // 自动更新只补充新曲，保留用户手动添加和排列的内容。
            const latest = library.getPlaylists().find((item) => item.id === playlist.id)
            if (!latest?.autoRefresh) continue
            const old = library.queryPlaylistSongs(playlist.id)
            const keys = new Set(old.map(getMusicItemKey))
            const added = songs.filter((item) => !keys.has(getMusicItemKey(item)))
            if (added.length) library.replacePlaylistSongs(playlist.id, [...old, ...added])
          } catch (e) {
            console.warn('[playlist] 自动更新失败，保留本地歌单', playlist.id, e)
          }
        }
      })()
    }, 10000)
    timer.unref()
  })
}
