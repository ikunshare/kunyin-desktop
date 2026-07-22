import { IpcChannels, type AppSettings, type DeepPartial } from '@common'
import { handle, sendToRenderer } from '../helpers'
import { getSettings, updateSettings } from '../../store/settings'
import { applyProxy } from '../../net/proxy'

export function registerSettingsHandlers(): void {
  handle(IpcChannels.SETTINGS_GET, () => getSettings())
  handle(IpcChannels.SETTINGS_SET, (patch: DeepPartial<AppSettings>) => {
    const next = updateSettings(patch)
    // 广播给渲染层，便于多处 UI 同步
    sendToRenderer(IpcChannels.SETTINGS_CHANGED, next)
    // 代理设置变更即时生效
    if (patch.network?.proxy) void applyProxy()
    return next
  })
}
