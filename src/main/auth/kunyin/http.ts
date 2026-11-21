/**
 * 账号登录用的原生 HTTP 客户端（Node https）。
 *
 * 为什么不用 net/request.ts 的 net.fetch：QQ 登录面板的本地服务
 * （localhost.ptlogin2.qq.com）只接受 `Origin: https://graph.qq.com`，而 Origin 在
 * Chromium 的 fetch 里属于禁止修改的请求头；Node 的 https 可以原样设置。
 * 本地服务还是自签证书，需要按请求关掉证书校验（仅限这一路）。
 */
import { request as httpsRequest } from 'node:https'
import type { IncomingHttpHeaders } from 'node:http'
import { createGunzip } from 'node:zlib'

export interface NativeResponse {
  status: number
  headers: IncomingHttpHeaders
  body: string
  /** set-cookie 统一成字符串数组，供 pickCookie 使用 */
  setCookie: string[]
}

export interface NativeRequestOptions {
  method?: string
  headers?: Record<string, string>
  body?: string
  /** 整个请求的总预算，默认 10s */
  timeout?: number
  /** 跳过证书校验（只给本机 QQ 客户端用） */
  insecure?: boolean
}

export function nativeRequest(
  url: string,
  options: NativeRequestOptions = {}
): Promise<NativeResponse> {
  const budget = options.timeout ?? 10000
  const u = new URL(url)
  return new Promise((resolve, reject) => {
    let settled = false
    // 用对象持有定时器：finish 在 setTimeout 之前就要定义，直接 let 变量会被 prefer-const 拦
    const state: { timer?: NodeJS.Timeout } = {}
    const finish = (fn: () => void): void => {
      if (settled) return
      settled = true
      if (state.timer) clearTimeout(state.timer)
      fn()
    }

    const req = httpsRequest(
      {
        hostname: u.hostname,
        port: u.port || 443,
        path: `${u.pathname}${u.search}`,
        method: options.method ?? 'GET',
        headers: options.headers,
        rejectUnauthorized: options.insecure !== true,
        timeout: 0
      },
      (res) => {
        // 没主动要 gzip，但 CDN 偶尔照压，兜一下
        const stream = res.headers['content-encoding'] === 'gzip' ? res.pipe(createGunzip()) : res
        const chunks: Buffer[] = []
        stream.on('data', (c: Buffer) => chunks.push(c))
        stream.on('end', () => {
          const raw = res.headers['set-cookie']
          finish(() =>
            resolve({
              status: res.statusCode ?? 0,
              headers: res.headers,
              body: Buffer.concat(chunks).toString('utf-8'),
              setCookie: Array.isArray(raw) ? raw : raw ? [raw] : []
            })
          )
        })
        stream.on('error', (e: Error) => finish(() => reject(e)))
      }
    )

    state.timer = setTimeout(() => {
      const message = `请求超时（${budget}ms）`
      req.destroy(new Error(message))
      finish(() => reject(new Error(message)))
    }, budget)

    req.on('error', (e: Error) => finish(() => reject(e)))
    if (options.body != null) req.write(options.body)
    req.end()
  })
}
