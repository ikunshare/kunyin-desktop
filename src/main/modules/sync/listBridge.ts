/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 本地歌单 ↔ LX ListData 桥接 + RPC 处理（1:1 移植 Android sync/SyncListBridge.kt）。
 * 试听列表 ↔ defaultList，我的收藏 ↔ loveList，其它自建歌单 ↔ userList[*].list。
 * 只同步用户自建歌单（remoteSource 空）与已被 LX 关联的歌单（remoteSource=='lx'）。
 */
import { getMusicItemKey, type MusicItem } from '@common'
import * as store from '../../store/library'
import { SyncProtocol } from './protocol'
import { md5OfListData } from './crypto'
import { songFromJson, songToJson } from './codec'
import type { SyncRpc } from './rpc'

type Json = Record<string, any>

interface Playlist {
  id: number
  name: string
  createdAt: number
  isSystem: boolean
  systemKind?: 'trial' | 'favorites'
  remoteSource?: string
  remoteId?: string
}

function playlists(): Playlist[] {
  return store.getPlaylists() as unknown as Playlist[]
}

function isLxSyncable(p: Playlist): boolean {
  return !p.isSystem && (p.remoteSource == null || p.remoteSource === 'lx')
}

export class SyncListBridge {
  private activeRpc: SyncRpc | null = null
  private lastSyncedMd5: string | null = null
  private pendingHandshakeMd5: string | null = null
  private handshakeListDataSent = false
  private initialSyncActive = false
  private listReady = false
  private pendingLocalPush = false
  private pendingReadyForcePush = false

  private watchUnsub: (() => void) | null = null
  private watchTimer: ReturnType<typeof setTimeout> | null = null
  private readyFlushTimer: ReturnType<typeof setTimeout> | null = null

  constructor(private resolveMode: () => string) {}

  registerHandlers(rpc: SyncRpc): void {
    this.activeRpc = rpc
    this.pendingHandshakeMd5 = null
    this.handshakeListDataSent = false
    this.initialSyncActive = true
    this.listReady = false
    this.pendingLocalPush = false
    this.pendingReadyForcePush = false

    rpc.register('getEnabledFeatures', () => ({
      [SyncProtocol.FEATURE_LIST]: SyncProtocol.FEATURE_VERSION_LIST
    }))

    rpc.register('list_sync_get_md5', () => {
      const md5 = md5OfListData(this.buildListData())
      this.pendingHandshakeMd5 = md5
      return md5
    })
    rpc.register('list_sync_get_list_data', () => {
      this.handshakeListDataSent = true
      const data = this.buildListData()
      this.pendingHandshakeMd5 = md5OfListData(data)
      return data
    })
    rpc.register('list_sync_set_list_data', (args) => {
      const payload = args[0]
      if (!payload || typeof payload !== 'object') {
        throw new Error('list_sync_set_list_data: missing payload')
      }
      this.applyListData(
        payload as Json,
        this.initialSyncActive ? this.shouldRemoveMissingOnListData() : true
      )
      this.lastSyncedMd5 = md5OfListData(this.buildListData())
      return null
    })
    rpc.register('list_sync_get_sync_mode', () => this.resolveMode())

    rpc.register('onListSyncAction', (args) => {
      const action = args[0]
      if (action && typeof action === 'object') this.handleSyncAction(action as Json)
      return null
    })

    rpc.register('list_sync_finished', () => {
      void this.markHandshakeFinished(500)
      return null
    })
    rpc.register('dislike_sync_finished', () => null)
    rpc.register('finished', () => {
      void this.markHandshakeFinished(0)
      return null
    })

    this.startLocalChangeWatcher()
  }

  unregisterHandlers(): void {
    this.activeRpc = null
    if (this.watchUnsub) {
      this.watchUnsub()
      this.watchUnsub = null
    }
    if (this.watchTimer) {
      clearTimeout(this.watchTimer)
      this.watchTimer = null
    }
    if (this.readyFlushTimer) {
      clearTimeout(this.readyFlushTimer)
      this.readyFlushTimer = null
    }
    this.lastSyncedMd5 = null
    this.pendingHandshakeMd5 = null
    this.handshakeListDataSent = false
    this.initialSyncActive = false
    this.listReady = false
    this.pendingLocalPush = false
    this.pendingReadyForcePush = false
  }

  /** 监听本地变更，去抖 1.5 秒后若 md5 变化则把 ListData 通过 list_data_overwrite 推给服务端。 */
  private startLocalChangeWatcher(): void {
    if (this.watchUnsub) this.watchUnsub()
    const onChange = (): void => {
      if (this.watchTimer) clearTimeout(this.watchTimer)
      this.watchTimer = setTimeout(() => void this.tryPushListData(), 1500)
    }
    this.watchUnsub = store.onLibraryChange(onChange)
  }

  private async tryPushListData(force = false): Promise<void> {
    const rpc = this.activeRpc
    if (!rpc) return
    if (!this.listReady) {
      this.pendingLocalPush = true
      return
    }
    const payload = this.buildListData()
    const md5 = md5OfListData(payload)
    if (!force && md5 === this.lastSyncedMd5) return
    try {
      await rpc.call('onListSyncAction', { action: 'list_data_overwrite', data: payload })
      this.lastSyncedMd5 = md5
    } catch {
      this.pendingLocalPush = true
    }
  }

  private async markHandshakeFinished(delayReadyMs: number): Promise<void> {
    let forcePushAfterFinish = false
    if (
      !this.initialSyncActive &&
      this.pendingHandshakeMd5 == null &&
      !this.handshakeListDataSent
    ) {
      this.scheduleReadyFlush(delayReadyMs, false)
      return
    }
    const current = md5OfListData(this.buildListData())
    const pending = this.pendingHandshakeMd5
    const localListWasAccepted =
      this.handshakeListDataSent && pending != null && current === pending
    if (this.pendingLocalPush) {
      forcePushAfterFinish = true
    } else if (current === this.lastSyncedMd5 || localListWasAccepted) {
      this.lastSyncedMd5 = current
    } else {
      forcePushAfterFinish = this.activeRpc != null
    }
    this.pendingHandshakeMd5 = null
    this.handshakeListDataSent = false
    this.initialSyncActive = false
    this.scheduleReadyFlush(delayReadyMs, forcePushAfterFinish)
  }

  private scheduleReadyFlush(delayReadyMs: number, force: boolean): void {
    if (force) this.pendingReadyForcePush = true
    if (this.readyFlushTimer) clearTimeout(this.readyFlushTimer)
    this.readyFlushTimer = setTimeout(
      () => {
        this.listReady = true
        const shouldPush = this.pendingLocalPush || this.pendingReadyForcePush
        this.pendingLocalPush = false
        this.pendingReadyForcePush = false
        if (shouldPush) void this.tryPushListData(true)
      },
      Math.max(0, delayReadyMs)
    )
  }

  // ─── 本地 → 远端 ───

  private buildListData(): Json {
    const pls = playlists()
    const trialPid = pls.find((p) => p.systemKind === 'trial')?.id ?? 0
    const favPid = pls.find((p) => p.systemKind === 'favorites')?.id ?? 0

    const defaultList = trialPid > 0 ? this.songsAsLx(store.queryPlaylistSongs(trialPid)) : []
    const loveList = favPid > 0 ? this.songsAsLx(store.queryPlaylistSongs(favPid)) : []

    const userList: Json[] = []
    for (const pl of pls) {
      if (!isLxSyncable(pl)) continue
      let id = pl.remoteId
      if (!id) {
        id = `local_${pl.id}`
        store.setRemoteIdDirect(pl.id, 'lx', id)
      }
      userList.push({
        id,
        name: pl.name,
        list: this.songsAsLx(store.queryPlaylistSongs(pl.id)),
        locationUpdateTime: pl.createdAt
      })
    }

    return { defaultList, loveList, userList }
  }

  private songsAsLx(items: MusicItem[]): Json[] {
    const arr: Json[] = []
    for (const it of items) {
      const song = songToJson(it)
      if (song.id != null && song.source != null) arr.push(song)
    }
    return arr
  }

  // ─── 远端 → 本地 ───

  private applyListData(payload: Json, removeMissing: boolean): void {
    const def: Json[] = Array.isArray(payload.defaultList) ? payload.defaultList : []
    const love: Json[] = Array.isArray(payload.loveList) ? payload.loveList : []
    const user: Json[] = Array.isArray(payload.userList) ? payload.userList : []

    const trialPid = store.getTrialPlaylistId()
    if (trialPid > 0) this.replacePlaylist(trialPid, def, removeMissing)
    const favPid = store.getFavoritesPlaylistId()
    if (favPid > 0) this.replacePlaylist(favPid, love, removeMissing)

    const now = Date.now()
    const byRemoteId = new Map<string, number>()
    const byName = new Map<string, number>()
    for (const p of playlists()) {
      if (p.remoteSource === 'lx' && !p.isSystem && p.remoteId) byRemoteId.set(p.remoteId, p.id)
      if (isLxSyncable(p)) byName.set(p.name, p.id)
    }

    for (const el of user) {
      if (!el || typeof el !== 'object') continue
      const remoteId = typeof el.id === 'string' ? el.id : undefined
      const name = typeof el.name === 'string' ? el.name : undefined
      if (!name) continue
      const songsEl: Json[] = Array.isArray(el.list) ? el.list : []
      let pid = (remoteId ? byRemoteId.get(remoteId) : undefined) ?? byName.get(name)
      if (pid == null) {
        pid = store.createPlaylistDirect(name, now)
        if (remoteId) {
          store.setRemoteIdDirect(pid, 'lx', remoteId)
          byRemoteId.set(remoteId, pid)
        }
        byName.set(name, pid)
      }
      if (pid <= 0) continue
      if (remoteId && byRemoteId.get(remoteId) !== pid) {
        store.setRemoteIdDirect(pid, 'lx', remoteId)
        byRemoteId.set(remoteId, pid)
      }
      this.replacePlaylist(pid, songsEl, removeMissing)
    }

    store.refreshAfterRestore()
  }

  private shouldRemoveMissingOnListData(): boolean {
    return this.resolveMode() === 'overwrite_remote_local'
  }

  private replacePlaylist(pid: number, lxSongs: Json[], removeMissing: boolean): void {
    const existing = new Map<string, { id: number; source: string }>()
    for (const { songJson } of store.queryPlaylistSongsRaw(pid)) {
      const item = safeParse(songJson)
      if (!item) continue
      existing.set(getMusicItemKey(item), { id: item.id, source: item.type })
    }

    const now = Date.now()
    let pos = 0
    const seen = new Set<string>()
    for (const el of lxSongs) {
      if (!el || typeof el !== 'object') continue
      const item = songFromJson(el)
      if (!item) continue
      const key = getMusicItemKey(item)
      if (seen.has(key)) continue
      seen.add(key)
      if (existing.delete(key)) {
        // 已存在，不调整顺序
      } else {
        store.addToPlaylistDirect(pid, JSON.stringify(item), now + pos, pos)
      }
      pos++
    }

    if (removeMissing && existing.size > 0) {
      for (const song of existing.values()) {
        store.removeFromPlaylistDirect(pid, song.id, song.source)
      }
    }
  }

  // ─── Action 处理 ───

  private pickListId(data: Json, ...keys: string[]): string | null {
    for (const k of keys) {
      const v = data[k]
      if (v != null && (typeof v === 'string' || typeof v === 'number')) {
        const s = String(v)
        if (s.trim()) return s
      }
    }
    return null
  }

  private resolveFromData(data: Json): number {
    const raw = this.pickListId(data, 'id', 'listId')
    return raw ? this.resolvePlaylistId(raw) : 0
  }

  private resolvePlaylistId(listId: string): number {
    if (listId === 'default') return store.getTrialPlaylistId()
    if (listId === 'love') return store.getFavoritesPlaylistId()
    return (
      playlists().find((p) => p.remoteSource === 'lx' && p.remoteId === listId && !p.isSystem)
        ?.id ?? 0
    )
  }

  private handleSyncAction(action: Json): void {
    const kind = typeof action.action === 'string' ? action.action : null
    if (!kind) return
    const data =
      action.data && typeof action.data === 'object' ? (action.data as Json) : ({} as Json)
    try {
      this.dispatchAction(kind, data)
    } catch {
      /* ignore malformed action */
    }
    store.refreshAfterRestore()
    this.lastSyncedMd5 = md5OfListData(this.buildListData())
  }

  private dispatchAction(kind: string, data: Json): void {
    switch (kind) {
      case 'list_data_overwire':
      case 'list_data_overwrite':
        this.applyListData(
          data,
          this.initialSyncActive ? this.shouldRemoveMissingOnListData() : true
        )
        break
      case 'list_music_add':
        this.onMusicAdd(data)
        break
      case 'list_music_remove':
        this.onMusicRemove(data)
        break
      case 'list_music_move':
        this.onMusicMove(data)
        break
      case 'list_music_update':
        this.onMusicUpdate(data)
        break
      case 'list_music_overwrite':
        this.onMusicOverwrite(data)
        break
      case 'list_music_clear':
        this.onMusicClear(data)
        break
      case 'list_music_update_position':
        this.onMusicUpdatePosition(data)
        break
      case 'list_add':
        this.onListAdd(data)
        break
      case 'list_remove':
        this.onListRemove(data)
        break
      case 'list_update':
        this.onListUpdate(data)
        break
      // list_update_position 及只读请求忽略
    }
  }

  private onMusicAdd(data: Json): void {
    const pid = this.resolveFromData(data)
    if (pid <= 0) return
    const musics: Json[] = Array.isArray(data.musicInfos) ? data.musicInfos : []
    const loc = typeof data.addMusicLocationType === 'string' ? data.addMusicLocationType : 'bottom'
    const now = Date.now()
    const items = musics.map((m) => songFromJson(m)).filter((x): x is MusicItem => !!x)
    if (loc === 'top') {
      store.shiftPositionsDirect(pid, items.length)
      items.forEach((item, idx) =>
        store.addToPlaylistDirect(pid, JSON.stringify(item), now + idx, idx)
      )
    } else {
      items.forEach((item, idx) => store.appendSongDirect(pid, JSON.stringify(item), now + idx))
    }
  }

  private onMusicRemove(data: Json): void {
    const pid = this.resolveFromData(data)
    if (pid <= 0) return
    const ids: Json[] = Array.isArray(data.ids)
      ? data.ids
      : Array.isArray(data.musicInfos)
        ? data.musicInfos
        : []
    const idToLocal = this.lxIdMap(pid)
    for (const el of ids) {
      const lxId = typeof el === 'string' ? el : undefined
      if (!lxId) continue
      const item = idToLocal.get(lxId)
      if (item) store.removeFromPlaylistDirect(pid, item.id, item.type)
    }
  }

  private onMusicOverwrite(data: Json): void {
    const pid = this.resolveFromData(data)
    if (pid <= 0) return
    const musics: Json[] = Array.isArray(data.musicInfos) ? data.musicInfos : []
    store.clearPlaylistDirect(pid)
    const now = Date.now()
    musics.forEach((el, idx) => {
      const item = songFromJson(el)
      if (item) store.addToPlaylistDirect(pid, JSON.stringify(item), now + idx, idx)
    })
  }

  private onMusicClear(data: Json): void {
    const pid = this.resolveFromData(data)
    if (pid > 0) store.clearPlaylistDirect(pid)
  }

  private onMusicUpdate(data: Json): void {
    const pid = this.resolveFromData(data)
    if (pid <= 0) return
    const musics: Json[] = Array.isArray(data.musicInfos) ? data.musicInfos : []
    const idToLocal = this.lxIdMap(pid)
    for (const el of musics) {
      if (!el || typeof el !== 'object') continue
      const lxId = typeof el.id === 'string' ? el.id : undefined
      if (!lxId) continue
      const old = idToLocal.get(lxId)
      if (!old) continue
      const updated = songFromJson(el)
      if (!updated) continue
      const pos = this.currentPosition(pid, old.id, old.type)
      store.removeFromPlaylistDirect(pid, old.id, old.type)
      if (pos >= 0) store.addToPlaylistDirect(pid, JSON.stringify(updated), Date.now(), pos)
      else store.appendSongDirect(pid, JSON.stringify(updated), Date.now())
    }
  }

  private currentPosition(pid: number, songId: number, source: string): number {
    for (const { songJson, position } of store.queryPlaylistSongsRaw(pid)) {
      const item = safeParse(songJson)
      if (item && item.id === songId && item.type === source) return position
    }
    return -1
  }

  private onMusicMove(data: Json): void {
    const fromRaw = this.pickListId(data, 'fromId', 'fromListId')
    const toRaw = this.pickListId(data, 'toId', 'toListId')
    if (!fromRaw || !toRaw) return
    const fromPid = this.resolvePlaylistId(fromRaw)
    const toPid = this.resolvePlaylistId(toRaw)
    if (fromPid <= 0 || toPid <= 0) return
    const musics: Json[] = Array.isArray(data.musicInfos) ? data.musicInfos : []
    const byLxId = this.lxIdMap(fromPid)
    const now = Date.now()
    for (const el of musics) {
      if (!el || typeof el !== 'object') continue
      const lxId = typeof el.id === 'string' ? el.id : undefined
      if (!lxId) continue
      const item = byLxId.get(lxId)
      if (!item) continue
      store.removeFromPlaylistDirect(fromPid, item.id, item.type)
      store.appendSongDirect(toPid, JSON.stringify(item), now)
    }
  }

  private onMusicUpdatePosition(data: Json): void {
    const pid = this.resolveFromData(data)
    if (pid <= 0) return
    const position = typeof data.position === 'number' ? data.position : null
    if (position == null) return
    const ids: unknown[] = Array.isArray(data.ids) ? data.ids : []
    const byLxId = this.lxIdMap(pid)
    ids.forEach((el, offset) => {
      const lxId = typeof el === 'string' ? el : undefined
      if (!lxId) return
      const item = byLxId.get(lxId)
      if (item) {
        store.moveSongInPlaylistDirect(pid, item.id, item.type, Math.max(0, position + offset))
      }
    })
  }

  private onListAdd(data: Json): void {
    const lists: Json[] = Array.isArray(data.list) ? data.list : []
    for (const o of lists) {
      if (!o || typeof o !== 'object') continue
      const name = typeof o.name === 'string' ? o.name : undefined
      if (!name) continue
      const remoteId = typeof o.id === 'string' ? o.id : undefined
      if (
        remoteId &&
        playlists().some((p) => p.remoteSource === 'lx' && p.remoteId === remoteId && !p.isSystem)
      ) {
        continue
      }
      const newPid = store.createPlaylistDirect(name, Date.now())
      if (newPid <= 0) continue
      if (remoteId) store.setRemoteIdDirect(newPid, 'lx', remoteId)
      const songsArr: Json[] = Array.isArray(o.list) ? o.list : []
      songsArr.forEach((se, idx) => {
        const item = songFromJson(se)
        if (item) store.addToPlaylistDirect(newPid, JSON.stringify(item), Date.now() + idx, idx)
      })
    }
  }

  private onListRemove(data: Json): void {
    const ids: unknown[] = Array.isArray(data.ids) ? data.ids : []
    for (const el of ids) {
      const remoteId = typeof el === 'string' ? el : undefined
      if (!remoteId) continue
      const pl = playlists().find(
        (p) => p.remoteSource === 'lx' && p.remoteId === remoteId && !p.isSystem
      )
      if (pl) store.deletePlaylistDirect(pl.id)
    }
  }

  private onListUpdate(data: Json): void {
    const lists: Json[] = Array.isArray(data.list) ? data.list : []
    for (const o of lists) {
      if (!o || typeof o !== 'object') continue
      const remoteId = typeof o.id === 'string' ? o.id : undefined
      const name = typeof o.name === 'string' ? o.name : undefined
      if (!remoteId || !name) continue
      const pl = playlists().find(
        (p) => p.remoteSource === 'lx' && p.remoteId === remoteId && !p.isSystem
      )
      if (pl && pl.name !== name) store.renamePlaylistDirect(pl.id, name)
    }
  }

  /** 当前歌单每首歌的 LX id → MusicItem。 */
  private lxIdMap(pid: number): Map<string, MusicItem> {
    const map = new Map<string, MusicItem>()
    for (const item of store.queryPlaylistSongs(pid)) {
      const lxId = songToJson(item).id
      if (typeof lxId === 'string') map.set(lxId, item)
    }
    return map
  }
}

function safeParse(json: string): MusicItem | null {
  try {
    return JSON.parse(json) as MusicItem
  } catch {
    return null
  }
}
