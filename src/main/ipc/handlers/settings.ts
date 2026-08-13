import { IpcChannels, type AppSettings, type CacheKind, type DeepPartial } from '@common'
import { handle, sendToAllRenderers } from '../helpers'
import { getSettings, updateSettings } from '../../store/settings'
import { applyProxy, getProxyStatus } from '../../net/proxy'
import { appEvent } from '../../core/events'
import {
  clearLyricCacheAll,
  clearResourceCache,
  clearUrlCache,
  getCacheStats
} from '../../cache/manager'

export function registerSettingsHandlers(): void {
  handle(IpcChannels.SETTINGS_GET, () => getSettings())
  handle(IpcChannels.SETTINGS_SET, (patch: DeepPartial<AppSettings>) => {
    const next = updateSettings(patch)
    // 广播给主窗口与桌面歌词窗口，便于设置和悬浮工具栏双向同步
    sendToAllRenderers(IpcChannels.SETTINGS_CHANGED, next)
    appEvent.emit('settings-updated', next)
    // 代理设置变更即时生效
    if (patch.network?.proxy) void applyProxy()
    return next
  })
  handle(IpcChannels.SETTINGS_PROXY_STATUS, () => getProxyStatus())

  handle(IpcChannels.CACHE_STATS, () => getCacheStats())
  // 清理后回最新用量，省一次往返
  handle(IpcChannels.CACHE_CLEAR, async (kind: CacheKind) => {
    if (kind === 'resource') await clearResourceCache()
    else if (kind === 'url') clearUrlCache()
    else if (kind === 'lyric') clearLyricCacheAll()
    return getCacheStats()
  })
}
