import { app, BrowserWindow, dialog } from 'electron'
import { electronApp } from '@electron-toolkit/utils'
import { createMainWindow, showMainWindow } from './windows/main'
import { registerIpc } from './ipc'
import { registerModules } from './modules'
import { registerAudioScheme, installAudioProtocol } from './audio/protocol'
import { checkOnStartup } from './auth/manager'
import { initCredentials, scheduleLoginRefresh } from './auth/credentials'
import { applyProxy } from './net/proxy'
import { initAppDataDir } from './core/paths'
import { appEvent } from './core/events'
import { createLogger, initLogger, setLogLevel, setLogToFile } from './core/logger'
import { getSettings } from './store/settings'
import { qmcWasmStatus } from './crypto/qmcWasm'

const log = createLogger('boot')

// Chromium 启动参数必须在 app ready 前设置，否则不会生效
app.commandLine.appendSwitch('ignore-certificate-errors')

// 对 Chromium 页面与 Electron net 请求统一放行无效证书
app.on('certificate-error', (event, _webContents, _url, _error, _certificate, callback) => {
  event.preventDefault()
  callback(true)
})

// 自定义音频协议 kunyin:// 必须在 app ready 前注册为特权 scheme
registerAudioScheme()

// 单实例锁：第二个实例启动时聚焦已有窗口
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      showMainWindow()
    }
  })

  const ready = app.whenReady().then(() => {
    // 须在任何数据文件读写前（applyProxy 读 settings、preload 同步读 settings.json）：
    // 建 userData/data/ 并把散落在根目录的旧数据一次性迁入，与 Chromium 数据分离
    initAppDataDir()

    // 紧随其后启动日志：再往后的每一步（代理、IPC、凭据、建窗）都可能失败，
    // 而 Release 包里除了日志文件没有别的现场可留
    const dev = getSettings().developer
    initLogger(dev.logLevel, dev.logToFile)
    appEvent.on('settings-updated', (s) => {
      setLogLevel(s.developer.logLevel)
      setLogToFile(s.developer.logToFile)
    })

    // QMC 解密后端：回退到纯 JS 不影响正确性（两条实现逐字节一致），但吞吐差 2~3.6 倍，
    // 排查「下载后解密很慢」时先看这条
    const qmcWasm = qmcWasmStatus()
    if (qmcWasm.available) log.info('QMC 解密后端：wasm')
    else log.warn('QMC 解密后端：纯 JS（wasm 不可用）', { reason: qmcWasm.reason })

    // Windows 任务栏/通知归属
    electronApp.setAppUserModelId('com.ikunshare.sound')

    installAudioProtocol()
    void applyProxy()
    registerIpc()
    // 平台登录凭据载入并注入各 provider（须在 registerIpc 后、创建窗口前）
    initCredentials()
    registerModules()
    createMainWindow()
    appEvent.emit('app-inited')
    log.info('启动流程完成', { bootMs: Math.round(process.uptime() * 1000) })

    // 本地有卡密则静默校验一次（不阻塞启动）
    void checkOnStartup()
    // 平台 token 续期（酷狗 token 有期限），延后跑避免和启动抢带宽
    scheduleLoginRefresh()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
      else showMainWindow()
    })
  })

  // 启动期致命错误（缺原生模块、userData 不可写等）不能只在终端留一条 unhandled
  // rejection——用户看到的会是「双击没反应」。弹窗说明原因后退出。
  ready.catch((e: unknown) => {
    const detail = e instanceof Error ? (e.stack ?? e.message) : String(e)
    log.error('启动失败', e)
    dialog.showErrorBox('坤音启动失败', detail)
    app.exit(1)
  })

  // 非 macOS：所有窗口关闭即退出
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
