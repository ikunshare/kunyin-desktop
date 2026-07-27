/**
 * 注册所有 IPC handler。分域拆分在 handlers/ 下，随分阶段实施补齐。
 */
import { registerAppHandlers } from './handlers/app'
import { registerWindowHandlers } from './handlers/window'
import { registerSettingsHandlers } from './handlers/settings'
import { registerSearchHandlers } from './handlers/search'
import { registerPlayerHandlers } from './handlers/player'
import { registerAuthHandlers } from './handlers/auth'
import { registerLibraryHandlers } from './handlers/library'
import { registerDiscoverHandlers } from './handlers/discover'
import { registerDownloadHandlers } from './handlers/download'
import { registerAccountHandlers } from './handlers/account'
import { registerRedirectHandlers } from './handlers/redirect'

export function registerIpc(): void {
  registerAppHandlers()
  registerWindowHandlers()
  registerSettingsHandlers()
  registerSearchHandlers()
  registerPlayerHandlers()
  registerAuthHandlers()
  registerLibraryHandlers()
  registerDiscoverHandlers()
  registerDownloadHandlers()
  registerAccountHandlers()
  registerRedirectHandlers()
}
