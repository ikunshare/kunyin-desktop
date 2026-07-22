/**
 * LX Music WebSocket 同步客户端（1:1 移植 Android sync/SyncClient.kt）。
 * 1. GET /hello 校验协议；2. GET /ah 密钥协商（clientID 快速校验或 CDK 激活）；
 * 3. WS /socket?i&t 建连；4. 解压帧交 SyncRpc；发帧前按大小 gzip；60s 心跳文本 "ping"。
 */
import WebSocket from 'ws'
import { requestRaw } from '../../net/request'
import { SyncProtocol } from './protocol'
import {
  aesDecrypt,
  aesEncrypt,
  compressMsg,
  decompressGzipBytes,
  decompressMsg,
  deriveAESKey,
  generateRsa,
  isGzipBytes,
  rsaDecrypt
} from './crypto'
import { SyncRpc } from './rpc'
import type { SyncListBridge } from './listBridge'

export type SyncStatus = 'idle' | 'connecting' | 'syncing' | 'connected' | 'failed'
export interface SyncSession {
  clientId: string
  aesKey: string
  serverName: string
}

export interface SyncClientStateStore {
  load(): SyncSession | null
  save(s: SyncSession): void
  clearSession(): void
}

export class SyncClient {
  private ws: WebSocket | null = null
  private rpc: SyncRpc | null = null
  private heartbeat: ReturnType<typeof setInterval> | null = null

  private shouldStayConnected = false
  private lastArgs: { serverUrl: string; cdk: string; deviceName: string } | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectAttempts = 0

  private _status: SyncStatus = 'idle'
  private _lastError: string | null = null
  private statusCb: ((s: SyncStatus, err: string | null) => void) | null = null

  constructor(
    private state: SyncClientStateStore,
    private bridge: SyncListBridge
  ) {}

  onStatus(cb: (s: SyncStatus, err: string | null) => void): void {
    this.statusCb = cb
  }
  get status(): SyncStatus {
    return this._status
  }
  get lastError(): string | null {
    return this._lastError
  }
  private setStatus(s: SyncStatus, err: string | null = this._lastError): void {
    this._status = s
    this._lastError = err
    this.statusCb?.(s, err)
  }

  connect(serverUrl: string, cdk: string, deviceName: string): void {
    const newArgs = { serverUrl, cdk, deviceName }
    const busy =
      this._status === 'connecting' || this._status === 'syncing' || this._status === 'connected'
    if (busy && this.argsEqual(this.lastArgs, newArgs) && this.shouldStayConnected) return

    this.shouldStayConnected = true
    this.lastArgs = newArgs
    this.reconnectAttempts = 0
    this.clearReconnect()
    this.teardownActive('reconnect')
    void this.connectInternal(serverUrl.trim().replace(/\/+$/, ''), cdk.trim(), deviceName)
  }

  disconnect(): void {
    this.shouldStayConnected = false
    this.clearReconnect()
    this.setStatus('idle', null)
    this.teardownActive('bye')
  }

  private argsEqual(a: typeof this.lastArgs, b: typeof this.lastArgs): boolean {
    return (
      !!a && !!b && a.serverUrl === b.serverUrl && a.cdk === b.cdk && a.deviceName === b.deviceName
    )
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  private teardownActive(reason: string): void {
    if (this.heartbeat) {
      clearInterval(this.heartbeat)
      this.heartbeat = null
    }
    this.bridge.unregisterHandlers()
    this.rpc?.destroy()
    this.rpc = null
    const ws = this.ws
    this.ws = null
    if (ws) {
      try {
        ws.close(SyncProtocol.CLOSE_NORMAL, reason)
      } catch {
        /* noop */
      }
    }
  }

  private scheduleReconnect(): void {
    if (!this.shouldStayConnected) return
    const args = this.lastArgs
    if (!args) return
    this.clearReconnect()
    const attempt = ++this.reconnectAttempts
    const delayMs =
      attempt === 1
        ? 3000
        : attempt === 2
          ? 5000
          : attempt === 3
            ? 10000
            : attempt === 4
              ? 20000
              : 30000
    this.reconnectTimer = setTimeout(() => {
      if (!this.shouldStayConnected) return
      void this.connectInternal(
        args.serverUrl.trim().replace(/\/+$/, ''),
        args.cdk.trim(),
        args.deviceName
      )
    }, delayMs)
  }

  private async connectInternal(baseUrl: string, cdk: string, deviceName: string): Promise<void> {
    this.setStatus('connecting', null)
    try {
      const base = this.normalizeBase(baseUrl)
      await this.probeHello(base)
      const session = await this.ensureSession(base, cdk, deviceName)
      this.state.save(session)
      this.openWebSocket(base, session)
    } catch (t) {
      this.setStatus('failed', (t as Error).message ?? '连接失败')
      this.scheduleReconnect()
    }
  }

  private normalizeBase(url: string): string {
    const lower = url.toLowerCase()
    if (lower.startsWith('http://') || lower.startsWith('https://')) return url
    if (lower.startsWith('ws://')) return 'http://' + url.slice('ws://'.length)
    if (lower.startsWith('wss://')) return 'https://' + url.slice('wss://'.length)
    return `http://${url}`
  }

  private async probeHello(base: string): Promise<void> {
    const r = await requestRaw(`${base}/hello`, { method: 'GET' })
    if (!r.ok) throw new Error(`hello 失败: HTTP ${r.status}`)
    const body = (await r.text()).trim()
    if (body !== SyncProtocol.HELLO_MSG) {
      throw new Error(`服务器不是 LX Music 同步协议 (reply=${body})`)
    }
  }

  private async ensureSession(base: string, cdk: string, deviceName: string): Promise<SyncSession> {
    const saved = this.state.load()
    if (saved) {
      const msg = `${SyncProtocol.AUTH_MSG}\n\n${deviceName}`
      const enc = aesEncrypt(msg, saved.aesKey)
      const resp = await this.callAuth(base, enc, saved.clientId)
      if (resp != null) {
        const hello = safe(() => aesDecrypt(resp, saved.aesKey))
        if (hello === SyncProtocol.HELLO_MSG) return saved
      }
    }

    // CDK 流程：本地 RSA keypair，公钥发服务端，服务端 RSA 加密回 clientID+key
    const kp = generateRsa()
    const body = [
      SyncProtocol.AUTH_MSG,
      kp.publicKeyPem,
      deviceName,
      SyncProtocol.CLIENT_KIND_MOBILE
    ].join('\n')
    const aesKey = deriveAESKey(cdk)
    const enc = aesEncrypt(body, aesKey)
    const resp = await this.callAuth(base, enc, null)
    if (resp == null) throw new Error('CDK 激活失败')
    const decrypted = rsaDecrypt(resp, kp.privateKey).toString('utf-8')
    const info = JSON.parse(decrypted) as { clientId: string; key: string; serverName?: string }
    return { clientId: info.clientId, aesKey: info.key, serverName: info.serverName ?? '' }
  }

  private async callAuth(
    base: string,
    encMsg: string,
    clientId: string | null
  ): Promise<string | null> {
    const headers: Record<string, string> = { m: encMsg }
    if (clientId) headers.i = clientId
    const r = await requestRaw(`${base}/ah`, { method: 'GET', headers })
    if (!r.ok) return null
    return r.text()
  }

  private openWebSocket(base: string, session: SyncSession): void {
    const wsBase = base.replace(/^http/i, 'ws')
    const token = aesEncrypt(SyncProtocol.MSG_CONNECT, session.aesKey)
    const url = `${wsBase}/socket?i=${encodeURIComponent(session.clientId)}&t=${encodeURIComponent(token)}`

    this.setStatus('syncing', null)
    const ws = new WebSocket(url)
    ws.binaryType = 'nodebuffer'
    this.ws = ws
    this.attachListeners(ws)
  }

  private sendFrame(text: string): boolean {
    const ws = this.ws
    if (!ws || ws.readyState !== WebSocket.OPEN) return false
    try {
      ws.send(compressMsg(text))
      return true
    } catch {
      return false
    }
  }

  private attachListeners(ws: WebSocket): void {
    ws.on('open', () => {
      if (ws !== this.ws) {
        ws.terminate()
        return
      }
      this.reconnectAttempts = 0
      const localRpc = new SyncRpc(
        (m) => this.sendFrame(m),
        () => {}
      )
      this.bridge.registerHandlers(localRpc)
      this.rpc = localRpc
      if (this.heartbeat) clearInterval(this.heartbeat)
      this.heartbeat = setInterval(() => {
        const cur = this.ws
        if (!cur || cur !== ws) {
          if (this.heartbeat) clearInterval(this.heartbeat)
          return
        }
        if (cur.readyState === WebSocket.OPEN) cur.send('ping')
      }, SyncProtocol.HEARTBEAT_SECS * 1000)
    })

    ws.on('message', (data: WebSocket.RawData, isBinary: boolean) => {
      if (ws !== this.ws) return
      let plain: string
      try {
        if (isBinary) {
          const raw = data as Buffer
          plain = isGzipBytes(raw) ? decompressGzipBytes(raw) : raw.toString('utf-8')
          plain = decompressMsg(plain)
        } else {
          plain = decompressMsg(data.toString())
        }
      } catch (e) {
        this._lastError = `decompress failed: ${(e as Error).message}`
        return
      }
      if (plain === 'ping' || plain === 'pong') return
      this.rpc?.handleIncoming(plain)
      if (this._status === 'syncing') this.setStatus('connected', null)
    })

    ws.on('close', () => {
      if (ws !== this.ws) return
      if (this.heartbeat) clearInterval(this.heartbeat)
      this.bridge.unregisterHandlers()
      this.rpc?.destroy()
      this.rpc = null
      this.ws = null
      if (this._status !== 'failed') this.setStatus('idle', this._lastError)
      this.scheduleReconnect()
    })

    ws.on('error', (err: Error) => {
      if (ws !== this.ws) return
      if (this.heartbeat) clearInterval(this.heartbeat)
      this.bridge.unregisterHandlers()
      this.rpc?.destroy()
      this.rpc = null
      this.ws = null
      this.setStatus('failed', err.message ?? '连接异常')
      this.scheduleReconnect()
    })
  }
}

function safe<T>(fn: () => T): T | null {
  try {
    return fn()
  } catch {
    return null
  }
}
