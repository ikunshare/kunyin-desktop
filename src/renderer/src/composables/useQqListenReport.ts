import { onScopeDispose, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { usePlayerStore, type PlayerTrackEvent } from '../stores/player'
import { useSettingsStore } from '../stores/settings'
import { getMusicItemKey, type MusicItem } from '@common'

/**
 * QQ 音乐听歌上报（对齐 Android PlayerViewModel 的三处触发）：
 *
 * - 曲目加载完成：listening(0) + recently（写入 QQ 音乐「最近播放」）
 * - 拖动进度：listening(当前位置)
 * - 播完 / 切歌 / 退出：listening(时长) + stream(本段实际播放秒数)
 *
 * 播放秒数按「真实播放的墙钟时间」累计：play 时记起点，pause 时结算；
 * 与进度条位置无关（拖动不会虚增）。非 QQ 曲目、未登录或设置关闭时主进程直接跳过。
 * 在应用根组件挂载时调用一次。
 */
export function useQqListenReport(): void {
  const player = usePlayerStore()
  const settings = useSettingsStore()
  const { current, playing, queue, duration } = storeToRefs(player)

  let tracked: MusicItem | null = null
  let accumulatedMs = 0
  let playStartAt = 0

  function enabled(): boolean {
    return settings.settings.player.qqListenReport
  }
  function isQq(item: MusicItem | null | undefined): item is MusicItem {
    return !!item && item.type === 'qq'
  }
  function qqIdsInQueue(): number[] {
    return queue.value.filter((m) => m.type === 'qq').map((m) => m.id)
  }
  function send(event: Parameters<typeof window.api.player.qqReport>[0]): void {
    if (!enabled()) return
    void window.api.player.qqReport(JSON.parse(JSON.stringify(event))).catch(() => {})
  }

  function settle(): void {
    if (playStartAt > 0) {
      accumulatedMs += Date.now() - playStartAt
      playStartAt = 0
    }
  }
  /** 结算并上报当前曲目的播放流水；切歌/播完/退出时调用 */
  function flushStream(): void {
    const item = tracked
    settle()
    const sec = Math.floor(accumulatedMs / 1000)
    accumulatedMs = 0
    if (!isQq(item) || sec <= 0) return
    send({ kind: 'stream', item, playTimeSec: sec })
  }

  function onEvent(e: PlayerTrackEvent): void {
    if (e.type === 'loaded') {
      // 同一首重新加载（直链过期重试 / 恢复播放）不算新的一次播放
      const same = tracked && getMusicItemKey(tracked) === getMusicItemKey(e.item)
      if (same) {
        // 同一首重新加载（直链过期重试）：先结算已播时长，别把这一段丢掉
        settle()
      } else {
        flushStream()
        tracked = e.item
        accumulatedMs = 0
      }
      playStartAt = playing.value ? Date.now() : 0
      if (!same && isQq(e.item)) {
        send({ kind: 'listening', item: e.item, playTimeMs: 0, playList: qqIdsInQueue() })
        send({ kind: 'recently', item: e.item })
      }
      return
    }
    if (!isQq(e.item)) return
    if (e.type === 'seek') {
      send({ kind: 'listening', item: e.item, playTimeMs: e.positionMs, playList: qqIdsInQueue() })
    } else if (e.type === 'ended') {
      send({
        kind: 'listening',
        item: e.item,
        playTimeMs: duration.value || e.item.duration,
        playList: qqIdsInQueue()
      })
      flushStream()
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
      flushStream()
      tracked = null
    }
  })
  // 关闭窗口前把最后一段播放流水交出去（IPC 是异步的，尽力而为）
  window.addEventListener('beforeunload', flushStream)

  /**
   * 作用域销毁时注销：player store 由 Pinia 持有、不随组件重建，
   * 监听器不摘除的话（开发期热更新、或根组件被重挂）会越积越多，导致同一次播放重复上报。
   */
  onScopeDispose(() => {
    offTrackEvent()
    window.removeEventListener('beforeunload', flushStream)
    flushStream()
  })
}
