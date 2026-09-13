import { app, globalShortcut } from 'electron'
import { IpcChannels, SHORTCUT_ACTIONS, type AppSettings } from '@common'
import { handle, sendToRenderer } from '../ipc/helpers'
import { appEvent } from '../core/events'
import { createLogger } from '../core/logger'
import { getSettings } from '../store/settings'

const log = createLogger('shortcuts')

/**
 * 保留给开发者工具的组合键。globalShortcut 是系统级抢占，一旦被登记成媒体快捷键，
 * 窗口级的 before-input-event（modules/devtools.ts）就再也收不到这个键 ——
 * 排查问题的后门会被用户自己的配置堵死，所以在这里直接拒掉。
 */
function isReserved(accelerator: string): boolean {
  return /^(?:(?:ctrl|control|cmd|command)\+)?f12$/i.test(accelerator.replace(/\s+/g, ''))
}

export function registerShortcuts(): void {
  const registered = new Set<string>()
  let errors: Record<string, string> = {}
  let previous = ''
  const apply = (settings: AppSettings): void => {
    const config = settings.player.shortcuts
    const key = JSON.stringify(config)
    if (key === previous) return
    previous = key
    for (const accelerator of registered) globalShortcut.unregister(accelerator)
    registered.clear()
    errors = {}
    for (const action of SHORTCUT_ACTIONS) {
      const accelerator = config[action.id]?.trim()
      if (!accelerator) continue
      if (!/(?:Control|Ctrl|Alt|Shift|Command|Cmd|Super)\+|^F\d{1,2}$/i.test(accelerator)) {
        errors[action.id] = '请使用带修饰键的组合键或功能键'
        continue
      }
      if (isReserved(accelerator)) {
        errors[action.id] = 'F12 / Ctrl+F12 已保留给开发者工具，请更换组合键'
        log.warn('拒绝注册保留快捷键', { action: action.id, accelerator })
        continue
      }
      try {
        if (
          registered.has(accelerator) ||
          !globalShortcut.register(accelerator, () =>
            sendToRenderer(IpcChannels.MEDIA_COMMAND, action.id)
          )
        ) {
          errors[action.id] = '快捷键已被占用，请更换组合键'
          log.warn('全局快捷键注册失败（被系统或其他程序占用）', {
            action: action.id,
            accelerator
          })
        } else registered.add(accelerator)
      } catch (e) {
        errors[action.id] = '无法注册该快捷键'
        log.error('全局快捷键注册异常', e, { action: action.id, accelerator })
      }
    }
    log.info('全局快捷键已应用', { count: registered.size, failed: Object.keys(errors).length })
  }
  apply(getSettings())
  appEvent.on('settings-updated', apply)
  handle(IpcChannels.MEDIA_SHORTCUT_STATUS, () => errors)
  app.on('will-quit', () => {
    for (const accelerator of registered) globalShortcut.unregister(accelerator)
  })
}
