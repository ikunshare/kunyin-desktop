import { onScopeDispose, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { usePlayerStore, type PlayerTrackEvent, type QueueSource } from '../stores/player'
import { getMusicItemKey, type MusicItem } from '@common'

/**
 * 听歌上报（QQ 音乐 + 网易云），两家共用同一套播放时长记账。
 *
 * QQ（对齐 Android PlayerViewModel 的三处触发）：
 * - 曲目加载完成：listening(0) + recently（写入 QQ 音乐「最近播放」）
 * - 拖动进度：listening(当前位置)
 * - 播完 / 切歌 / 退出：listening(时长) + stream(本段实际播放秒数)
 *
 * 网易云（PC 客户端埋点，见 main/providers/wy/report.ts）：
 * - 曲目加载完成：_plv（开始播放，带音质档与来源歌单）
 * - 播完 / 切歌 / 退出：_pld（本段实际播放秒数，听歌记录吃这一条）
 *
 * 播放秒数按「真实播放的墙钟时间」累计：play 时记起点，pause 时结算；
 * 与进度条位置无关（拖动不会虚增）。非对应平台的曲目、未登录时主进程直接跳过。
 * 在应用根组件挂载时调用一次。
 */
export function useListenReport(): void {
  const player = usePlayerStore()
  const { current, playing, queue, duration, quality, queueSource } = storeToRefs(player)

  let tracked: MusicItem | null = null
  /** 记下开播时的音质档与来源，结算时要用（其间用户可能已经切歌/切列表了） */
  let trackedQuality = ''
  let trackedSourceId: string | undefined

  let accumulatedMs = 0
  let playStartAt = 0

  function isQq(item: MusicItem | null | undefined): item is MusicItem {
    return !!item && item.type === 'qq'
  }
  function isWy(item: MusicItem | null | undefined): item is MusicItem {
    return !!item && item.type === 'wy'
  }
  function qqIdsInQueue(): number[] {
    return queue.value.filter((m) => m.type === 'qq').map((m) => m.id)
  }
  /** 当前队列若来自某个网易云歌单/专辑，取出它的 id（`平台:id` 形状），否则 undefined */
  function wySourceId(source: QueueSource | null): string | undefined {
    if (source?.kind !== 'platform' || !source.id) return undefined
    const [platform, id] = source.id.split(':')
    return platform === 'wy' && id ? id : undefined
  }

  function sendQq(event: Parameters<typeof window.api.player.qqReport>[0]): void {
    void window.api.player.qqReport(JSON.parse(JSON.stringify(event))).catch(() => {})
  }
  function sendWy(event: Parameters<typeof window.api.player.wyReport>[0]): void {
    void window.api.player.wyReport(JSON.parse(JSON.stringify(event))).catch(() => {})
  }

  function settle(): void {
    if (playStartAt > 0) {
      accumulatedMs += Date.now() - playStartAt
      playStartAt = 0
    }
  }
  /** 结算并上报当前曲目的播放时长；切歌/播完/退出时调用 */
  function flushPlayed(): void {
    const item = tracked
    const qualityId = trackedQuality
    const sourceId = trackedSourceId
    settle()
    const sec = Math.floor(accumulatedMs / 1000)
    accumulatedMs = 0
    if (sec <= 0) return
    if (isQq(item)) sendQq({ kind: 'stream', item, playTimeSec: sec })
    else if (isWy(item)) sendWy({ kind: 'end', item, qualityId, sourceId, playTimeSec: sec })
  }

  function onEvent(e: PlayerTrackEvent): void {
    if (e.type === 'loaded') {
      // 同一首重新加载（直链过期重试 / 恢复播放）不算新的一次播放
      const same = tracked && getMusicItemKey(tracked) === getMusicItemKey(e.item)
      if (same) {
        // 同一首重新加载（直链过期重试）：先结算已播时长，别把这一段丢掉
        settle()
      } else {
        flushPlayed()
        tracked = e.item
        accumulatedMs = 0
      }
      trackedQuality = quality.value
      trackedSourceId = wySourceId(queueSource.value)
      playStartAt = playing.value ? Date.now() : 0
      if (same) return
      if (isQq(e.item)) {
        sendQq({ kind: 'listening', item: e.item, playTimeMs: 0, playList: qqIdsInQueue() })
        sendQq({ kind: 'recently', item: e.item })
      } else if (isWy(e.item)) {
        sendWy({
          kind: 'start',
          item: e.item,
          qualityId: trackedQuality,
          sourceId: trackedSourceId
        })
      }
      return
    }
    if (e.type === 'seek') {
      // 网易云 PC 客户端拖动进度不单独上报，只有 QQ 要
      if (isQq(e.item))
        sendQq({
          kind: 'listening',
          item: e.item,
          playTimeMs: e.positionMs,
          playList: qqIdsInQueue()
        })
      return
    }
    if (e.type === 'ended') {
      if (isQq(e.item)) {
        sendQq({
          kind: 'listening',
          item: e.item,
          playTimeMs: duration.value || e.item.duration,
          playList: qqIdsInQueue()
        })
      }
      flushPlayed()
      // 单曲循环会紧接着从头播放，同一首不会再触发 loaded，这里重新起表
      tracked = e.item
    }
  }

  const offTrackEvent = player.onTrackEvent(onEvent)

  // 播放 / 暂停：累计真实播放时长
  watch(playing, (now) => {
    if (now) {
      if (!playStartAt) playStartAt = Date.now()
    } else settle()
  })
  // 队列被清空或当前曲被移除（没有新的 loaded）时也结算一次
  watch(current, (item) => {
    if (!item && tracked) {
      flushPlayed()
      tracked = null
    }
  })
  // 关闭窗口前把最后一段播放时长交出去（IPC 是异步的，尽力而为）
  window.addEventListener('beforeunload', flushPlayed)

  /**
   * 作用域销毁时注销：player store 由 Pinia 持有、不随组件重建，
   * 监听器不摘除的话（开发期热更新、或根组件被重挂）会越积越多，导致同一次播放重复上报。
   */
  onScopeDispose(() => {
    offTrackEvent()
    window.removeEventListener('beforeunload', flushPlayed)
    flushPlayed()
  })
}
