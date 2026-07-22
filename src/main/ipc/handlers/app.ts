import { app } from 'electron'
import { IpcChannels } from '@common'
import { handle } from '../helpers'

export function registerAppHandlers(): void {
  handle(IpcChannels.APP_VERSION, () => app.getVersion())
  handle(IpcChannels.APP_PLATFORM, () => process.platform)
}
