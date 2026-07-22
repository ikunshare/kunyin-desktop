/**
 * 应用级类型化事件总线（参照 lx-music-desktop 的 event_app 模式）。
 *
 * 主进程各模块通过它解耦：例如窗口创建后广播 `main-window-created`，
 * 模块监听 `app-inited` 再做自身初始化。后续同步功能会在此扩展 list/dislike 事件。
 */
import { EventEmitter } from 'node:events'
import type { BrowserWindow } from 'electron'
import type { AppSettings } from '@common'

/** 事件表：事件名 → 参数元组（用 type 而非 interface，以满足 Record 约束） */
export type AppEventMap = {
  'app-inited': []
  'main-window-created': [BrowserWindow]
  'settings-updated': [AppSettings]
}

class TypedEmitter<M extends Record<string, unknown[]>> {
  private readonly emitter = new EventEmitter()

  on<K extends keyof M & string>(event: K, listener: (...args: M[K]) => void): this {
    this.emitter.on(event, listener as (...args: unknown[]) => void)
    return this
  }

  off<K extends keyof M & string>(event: K, listener: (...args: M[K]) => void): this {
    this.emitter.off(event, listener as (...args: unknown[]) => void)
    return this
  }

  emit<K extends keyof M & string>(event: K, ...args: M[K]): boolean {
    return this.emitter.emit(event, ...args)
  }
}

export const appEvent = new TypedEmitter<AppEventMap>()
