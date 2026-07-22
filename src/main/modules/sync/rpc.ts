/**
 * LX 同步 RPC（1:1 移植 Android sync/SyncRpc.kt，与 Go 端 sync/rpc.go 双向兼容）。
 * - 请求帧带非空 `path` 数组；响应帧只有 `name` + `error` + `data`。
 * - `error` 无 omitempty：响应始终写 `"error":null` 或 `"error":"..."`。
 */
import { SyncProtocol } from './protocol'

export type RpcRequestHandler = (args: unknown[]) => Promise<unknown> | unknown

interface Pending {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export class SyncRpc {
  private pending = new Map<string, Pending>()
  private handlers = new Map<string, RpcRequestHandler>()
  private seq = Date.now()
  private destroyed = false

  constructor(
    private send: (msg: string) => boolean,
    private onError: (e: Error) => void
  ) {}

  register(method: string, handler: RpcRequestHandler): void {
    this.handlers.set(method, handler)
  }

  destroy(): void {
    this.destroyed = true
    for (const p of this.pending.values()) {
      clearTimeout(p.timer)
      p.reject(new Error('rpc destroyed'))
    }
    this.pending.clear()
  }

  /** 发起远程调用并等待回复；args 以 JSON 数组打包。 */
  call(method: string, ...args: unknown[]): Promise<unknown> {
    const name = `${method}__${++this.seq}`
    const frame = {
      name,
      path: method.split('.'),
      data: args.map((v) => (v === undefined ? null : v))
    }
    return new Promise<unknown>((resolve, reject) => {
      if (!this.send(JSON.stringify(frame))) {
        reject(new Error('rpc send failed: socket closed'))
        return
      }
      const timer = setTimeout(() => {
        this.pending.delete(name)
        reject(new Error(`rpc timeout: ${method}`))
      }, SyncProtocol.RPC_TIMEOUT_MS)
      this.pending.set(name, { resolve, reject, timer })
    })
  }

  /** 对端发来的一帧已解压 JSON。 */
  handleIncoming(text: string): void {
    if (this.destroyed) return
    let obj: Record<string, unknown>
    try {
      obj = JSON.parse(text) as Record<string, unknown>
    } catch {
      return
    }
    const name = typeof obj.name === 'string' ? obj.name : null
    if (!name) return

    const path = obj.path
    if (Array.isArray(path) && path.length > 0) {
      const method = path.join('.')
      const handler = this.handlers.get(method)
      if (!handler) {
        this.replyError(name, `${method} is not defined`)
        return
      }
      void this.runHandler(name, handler, obj.data)
      return
    }

    // 响应帧
    const p = this.pending.get(name)
    if (!p) return
    this.pending.delete(name)
    clearTimeout(p.timer)
    const err = typeof obj.error === 'string' && obj.error ? obj.error : null
    if (err) p.reject(new Error(`rpc error: ${err}`))
    else p.resolve(obj.data ?? null)
  }

  private async runHandler(name: string, handler: RpcRequestHandler, data: unknown): Promise<void> {
    try {
      const args: unknown[] = data == null ? [] : Array.isArray(data) ? data : [data]
      const result = await handler(args)
      this.replyOk(name, result)
    } catch (e) {
      this.replyError(name, (e as Error).message ?? 'handler error')
    }
  }

  private replyOk(name: string, result: unknown): void {
    const frame = { name, error: null, data: result === undefined ? null : result }
    if (!this.send(JSON.stringify(frame))) this.onError(new Error('rpc reply failed'))
  }

  private replyError(name: string, err: string): void {
    this.send(JSON.stringify({ name, error: err }))
  }
}
