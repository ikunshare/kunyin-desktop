/**
 * 系统媒体集成（对应 Android service/PlaybackService 的键位/通知部分）：
 * - 全局媒体键（globalShortcut，仅 Linux 兜底；见 registerGlobalShortcuts 说明）
 * - 系统托盘（播放控制 + 显示/退出）
 * - 任务栏缩略图工具栏（Windows ThumbarButton：上一首/播放暂停/下一首）
 * - 开机自启（app.setLoginItemSettings）
 *
 * SMTC 显示与传输控制（含 Windows/macOS 的键盘媒体键）走渲染层 Web MediaSession
 * （Chromium 自动桥接），此处补托盘与缩略图工具栏。命令经 MEDIA_COMMAND 转发给渲染层 player。
 */
import { app, globalShortcut, ipcMain, Menu, Tray, nativeImage, type BrowserWindow } from 'electron'
import { IpcChannels, type MediaCommand } from '@common'
import { getMainWindow, createMainWindow } from '../../windows/main'
import { appEvent } from '../../core/events'
import trayIconIco from '../../../../resources/icons/icon.ico?asset'
import trayIconPng from '../../../../resources/icons/32x32.png?asset'
import thumbPrev from '../../../../resources/icons/thumb-prev.png?asset'
import thumbPlay from '../../../../resources/icons/thumb-play.png?asset'
import thumbPause from '../../../../resources/icons/thumb-pause.png?asset'
import thumbNext from '../../../../resources/icons/thumb-next.png?asset'

let tray: Tray | null = null
/** 挂了缩略图工具栏的主窗口（播放状态变化时刷新播放/暂停按钮） */
let thumbarWin: BrowserWindow | null = null
/** 最近一次播放状态（窗口重建/重新显示时用来恢复按钮） */
let thumbarPlaying = false
/**
 * 任务栏按钮是否已就绪、可以挂缩略图工具栏了。
 * 在此之前的任何 setThumbarButtons 都会毁掉唯一一次 Add 机会（见 applyThumbar 注释），
 * 因此播放态变化、窗口显示等所有路径都得先过这道闸。
 */
let thumbarReady = false

function sendCommand(cmd: MediaCommand): void {
  const win = getMainWindow()
  if (win && !win.isDestroyed()) win.webContents.send(IpcChannels.MEDIA_COMMAND, cmd)
}

/**
 * 缩略图按钮图标尺寸。
 *
 * Windows 用 SM_CXSMICON（常规 DPI 下 16×16）尺寸的 imagelist 承载缩略图工具栏按钮。
 * 仓库里的源图是 64×64，原样交给 ThumbBarAddButtons 会因尺寸不匹配而整条工具栏都不显示，
 * 必须先降到小图标尺寸再传。
 */
const THUMB_ICON_SIZE = 16
const thumbIconCache = new Map<string, Electron.NativeImage>()
function thumbIcon(path: string): Electron.NativeImage {
  const cached = thumbIconCache.get(path)
  if (cached) return cached
  const raw = nativeImage.createFromPath(path)
  const icon = raw.isEmpty()
    ? raw
    : raw.resize({ width: THUMB_ICON_SIZE, height: THUMB_ICON_SIZE, quality: 'best' })
  thumbIconCache.set(path, icon)
  return icon
}

/**
 * 任务栏缩略图工具栏（Windows）：上一首 / 播放暂停 / 下一首。
 * 点击经 MEDIA_COMMAND 转发给渲染层 player，与托盘、全局媒体键共用同一入口。
 *
 * ⚠ 首次调用只有一次机会，必须等窗口真正显示、任务栏按钮已建立之后：
 * Electron 的 TaskbarHost 在首次 SetThumbarButtons 时走 ThumbBarAddButtons，
 * 之后一律走 ThumbBarUpdateButtons——而它把 thumbar_buttons_added_ 无条件置 true，
 * 并不看 Add 是否成功（shell/browser/ui/win/taskbar_host.cc）。于是在窗口还隐藏
 * （尚无任务栏按钮）时抢先调一次，Add 失败却把状态标记成已添加，此后所有 Update
 * 都作用在一个从未成功添加的窗口上，工具栏就再也不会出现——Electron 只在 explorer
 * 重启（TaskbarCreated 消息）时才会重置这个状态自愈。
 * 因此本函数只由 show 之后的路径调用，且首次调用留一点延迟等任务栏按钮就绪。
 */
function applyThumbar(): void {
  if (process.platform !== 'win32' || !thumbarWin || thumbarWin.isDestroyed()) return
  if (!thumbarReady || !thumbarWin.isVisible()) return
  thumbarWin.setThumbarButtons([
    {
      tooltip: '上一首',
      icon: thumbIcon(thumbPrev),
      click: () => sendCommand('prev')
    },
    {
      tooltip: thumbarPlaying ? '暂停' : '播放',
      icon: thumbIcon(thumbarPlaying ? thumbPause : thumbPlay),
      click: () => sendCommand('playpause')
    },
    {
      tooltip: '下一首',
      icon: thumbIcon(thumbNext),
      click: () => sendCommand('next')
    }
  ])
}

/** 更新播放状态：窗口可见时立刻刷新按钮，否则等下次 show 时重放 */
function setThumbarPlaying(playing: boolean): void {
  thumbarPlaying = playing
  if (thumbarWin && thumbarWin.isVisible()) applyThumbar()
}

function showMainWindow(): void {
  const win = getMainWindow() ?? createMainWindow()
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

/**
 * 全局媒体键 —— 仅 Linux 注册。
 *
 * Windows(SMTC) 与 macOS(NowPlaying) 上 Chromium 的 HardwareMediaKeyHandling 默认开启
 * （media/base/media_switches.cc：这两个平台是 FEATURE_ENABLED_BY_DEFAULT），键盘媒体键
 * 与耳机线控会由系统按「当前活跃媒体会话」路由给渲染层的 MediaSession handler。
 * 此时再用 globalShortcut 注册同一批键有两个副作用：
 * 1. Windows 侧走 RegisterHotKey 独占媒体键，系统再也不会把它交给 SMTC——
 *    只要本应用在跑，其它播放器的媒体键会一并失效，本应用的 SMTC 键路由也被抢走；
 * 2. 两条路径同时活跃时（蓝牙 AVRCP 常同时合成按键与 SMTC 事件）同一次按键触发两回，
 *    叠加 <audio> 播放态的异步更新就成了竞态——按一次播放随即被暂停。
 * （macOS 上 Electron 会在注册媒体键时主动关掉 Chromium 的内部处理，见其
 *  fix_media_key_usage_with_globalshortcuts.patch，SMTC/NowPlaying 同样会失效。）
 *
 * 因此这两个平台把媒体键交给系统媒体会话独占，本进程只保留托盘与任务栏缩略图工具栏的
 * MEDIA_COMMAND。Linux 各桌面环境的 MPRIS 可用性不稳定，仍注册兜底。
 */
function registerGlobalShortcuts(): void {
  if (process.platform !== 'linux') return
  // 注册失败（被占用）不阻断启动
  globalShortcut.register('MediaPlayPause', () => sendCommand('playpause'))
  globalShortcut.register('MediaNextTrack', () => sendCommand('next'))
  globalShortcut.register('MediaPreviousTrack', () => sendCommand('prev'))
}

function buildTray(): void {
  if (tray) return
  if (process.platform === 'win32') {
    // ico 含多尺寸，系统按 DPI 自动取合适的一档
    tray = new Tray(trayIconIco)
  } else {
    let image = nativeImage.createFromPath(trayIconPng)
    if (!image.isEmpty()) image = image.resize({ width: 16, height: 16 })
    tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image)
  }
  tray.setToolTip('坤音')

  const menu = Menu.buildFromTemplate([
    { label: '显示主窗口', click: showMainWindow },
    { type: 'separator' },
    { label: '播放/暂停', click: () => sendCommand('playpause') },
    { label: '上一首', click: () => sendCommand('prev') },
    { label: '下一首', click: () => sendCommand('next') },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        app.quit()
      }
    }
  ])
  tray.setContextMenu(menu)
  tray.on('double-click', showMainWindow)
}

/** 根据设置应用开机自启（Android 无此项，桌面新增；默认关闭）。 */
export function applyAutoLaunch(): void {
  // settings 暂无 autoLaunch 字段，预留：默认不开机自启。
  // 后续在 settings.appearance 或新增 system 分类加开关时接这里。
  app.setLoginItemSettings({ openAtLogin: false })
}

export function registerMediaModule(): void {
  registerGlobalShortcuts()
  buildTray()
  applyAutoLaunch()

  // 缩略图图标加载失败会导致按钮不可见，提前在控制台暴露便于排查
  if (process.platform === 'win32') {
    for (const [name, path] of [
      ['prev', thumbPrev],
      ['play', thumbPlay],
      ['pause', thumbPause],
      ['next', thumbNext]
    ] as const) {
      if (thumbIcon(path).isEmpty()) {
        console.warn(`[media] 缩略图图标加载失败: ${name} (${path})`)
      }
    }
  }

  // 渲染层推送播放状态 → 刷新缩略图工具栏的播放/暂停按钮
  ipcMain.on(IpcChannels.MEDIA_SET_STATE, (_e, playing: boolean) => {
    setThumbarPlaying(!!playing)
  })

  // 窗口创建后挂缩略图工具栏（Windows 专属；主窗口可能被销毁后重建）
  appEvent.on('main-window-created', (win) => {
    thumbarWin = win
    thumbarReady = false
    // 主窗口是 show:false 创建、等渲染层首帧绘制完才显示的，此刻还没有任务栏按钮。
    // 绝不能在这里抢先调 applyThumbar——首次 Add 失败会被永久记为「已添加」，
    // 之后只剩无效的 Update（详见 applyThumbar 注释）。
    // 首次显示后留一点时间等 Windows 建好任务栏按钮，再放闸并挂上工具栏。
    win.once('show', () => {
      setTimeout(() => {
        if (win.isDestroyed()) return
        thumbarReady = true
        applyThumbar()
      }, 500)
    })
    // 之后每次隐藏/显示都重放一遍（Electron 在窗口隐藏后会清掉缩略图按钮，
    // electron#28319）；那时已成功 Add 过，走 Update 即可生效。
    win.on('show', applyThumbar)
    win.on('closed', () => {
      if (thumbarWin === win) {
        thumbarWin = null
        thumbarReady = false
      }
    })
  })

  app.on('will-quit', () => {
    globalShortcut.unregisterAll()
  })
}
