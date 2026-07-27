import { app, ipcMain } from 'electron'
import { IpcChannels } from '@common'
import { handle } from '../helpers'
import { appDataPath } from '../../core/paths'

export function registerAppHandlers(): void {
  handle(IpcChannels.APP_VERSION, () => app.getVersion())
  handle(IpcChannels.APP_PLATFORM, () => process.platform)
  // preload 同步取应用数据目录 userData/data/（首屏主题防闪烁读 settings.json 用）
  ipcMain.on(IpcChannels.APP_USERDATA_PATH, (e) => {
    e.returnValue = appDataPath()
  })
}
