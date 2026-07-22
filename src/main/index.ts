import { app, BrowserWindow } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { createMainWindow } from './windows/main'
import { registerIpc } from './ipc'
import { registerModules } from './modules'
import { registerAudioScheme, installAudioProtocol } from './audio/protocol'
import { checkOnStartup } from './auth/manager'
import { initCredentials } from './auth/credentials'
import { applyProxy } from './net/proxy'
import { appEvent } from './core/events'

// 自定义音频协议 kunyin:// 必须在 app ready 前注册为特权 scheme
registerAudioScheme()

// 单实例锁：第二个实例启动时聚焦已有窗口
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  app.whenReady().then(() => {
    // Windows 任务栏/通知归属
    electronApp.setAppUserModelId('com.ikunshare.sound')

    // 开发期 F12 开关 DevTools、生产禁用刷新快捷键
    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    installAudioProtocol()
    void applyProxy()
    registerIpc()
    // 平台登录凭据载入并注入各 provider（须在 registerIpc 后、创建窗口前）
    initCredentials()
    registerModules()
    createMainWindow()
    appEvent.emit('app-inited')

    // 本地有卡密则静默校验一次（不阻塞启动）
    void checkOnStartup()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
    })
  })

  // 非 macOS：所有窗口关闭即退出
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
