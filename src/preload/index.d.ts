import { ElectronAPI } from '@electron-toolkit/preload'
import type { WindowApi } from '@common'

declare global {
  interface Window {
    electron: ElectronAPI
    api: WindowApi
  }
}
