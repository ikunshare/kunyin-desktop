import { net } from 'electron'
import { createLogger } from '../core/logger'
const log = createLogger('net')

/**
 * 主进程 HTTP 请求封装（音源用）。
 *
 * 走 Electron net.fetch（Chromium 网络栈）而非 Node 全局 fetch：
 * 前者遵循 net/proxy.ts 经 session.setProxy 应用的代理设置，后者完全无视——
 * 换用后音源接口（搜索/歌词/歌单）与取流、封面同一条代理路径，行为一致。
 */

export interface RequestOptions {
  method?: string
  headers?: Record<string, string>
  query?: Record<string, string | number | boolean | undefined>
  /** 对象 → JSON；字符串/URLSearchParams/Buffer 原样发送（Buffer 用于 gzip 等二进制体） */
  body?: string | URLSearchParams | Buffer | Record<string, unknown>
  cookie?: string
  timeout?: number
}

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'

function buildUrl(url: string, query?: RequestOptions['query']): string {
  if (!query) return url
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined) params.append(k, String(v))
  }
  const qs = params.toString()
  if (!qs) return url
  return url + (url.includes('?') ? '&' : '?') + qs
}

export async function requestRaw(url: string, options: RequestOptions = {}): Promise<Response> {
  const headers: Record<string, string> = { 'User-Agent': DEFAULT_UA, ...options.headers }
  if (options.cookie) headers['Cookie'] = options.cookie

  let body: string | URLSearchParams | ArrayBuffer | undefined
  if (options.body != null) {
    if (typeof options.body === 'string' || options.body instanceof URLSearchParams) {
      body = options.body
    } else if (Buffer.isBuffer(options.body)) {
      // 拷贝成独立 ArrayBuffer（Buffer 可能是池化切片，直接取 .buffer 会带上无关字节）
      body = new Uint8Array(options.body).buffer as ArrayBuffer
    } else {
      body = JSON.stringify(options.body)
      headers['Content-Type'] ??= 'application/json'
    }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeout ?? 15000)
  try {
    const response = await net.fetch(buildUrl(url, options.query), {
      method: options.method ?? 'GET',
      headers,
      body,
      signal: controller.signal
    })
    if (!response.ok) log.warn('HTTP 非成功响应', { url, status: response.status })
    return response
  } catch (error) {
    log.error('网络请求失败', error, { url, method: options.method ?? 'GET' })
    throw error
  } finally {
    clearTimeout(timer)
  }
}

/** net.request 的原始响应（能读到 set-cookie；net.fetch 的 Response 会把它当作 forbidden 头过滤掉） */
export interface RawNodeResponse {
  status: number
  headers: Record<string, string | string[]>
  body: Buffer
}

/**
 * 用 net.request（Node 风格）发请求并读回响应头与完整 body。
 * 与 requestRaw 不同：走 Electron net.request，`set-cookie` 以数组形式保留在 headers 里
 * （Electron 文档明确 set-cookie 恒为数组），供需要登录 cookie 的接口用。同样遵循 session 代理。
 */
export async function requestRawWithHeaders(
  url: string,
  options: RequestOptions = {}
): Promise<RawNodeResponse> {
  const headers: Record<string, string> = { 'User-Agent': DEFAULT_UA, ...options.headers }
  if (options.cookie) headers['Cookie'] = options.cookie

  let body: string | Buffer | undefined
  if (options.body != null) {
    if (typeof options.body === 'string' || Buffer.isBuffer(options.body)) {
      body = options.body
    } else if (options.body instanceof URLSearchParams) {
      body = options.body.toString()
    } else {
      body = JSON.stringify(options.body)
      headers['Content-Type'] ??= 'application/json'
    }
  }

  return await new Promise<RawNodeResponse>((resolve, reject) => {
    const req = net.request({
      method: options.method ?? 'GET',
      url: buildUrl(url, options.query)
    })
    for (const [k, v] of Object.entries(headers)) req.setHeader(k, v)

    const timer = setTimeout(() => req.abort(), options.timeout ?? 15000)
    req.on('response', (res) => {
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => {
        clearTimeout(timer)
        resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) })
      })
      res.on('error', (e: Error) => {
        clearTimeout(timer)
        log.warn('网络响应流失败', { url, error: e })
        reject(e)
      })
    })
    req.on('error', (e: Error) => {
      clearTimeout(timer)
      log.warn('网络请求失败', { url, error: e })
      reject(e)
    })
    if (body != null) req.write(body)
    req.end()
  })
}

export async function requestJson<T>(url: string, options: RequestOptions = {}): Promise<T> {
  const resp = await requestRaw(url, options)
  try {
    return (await resp.json()) as T
  } catch (error) {
    log.warn('JSON 响应解析失败', { url, status: resp.status, error })
    throw error
  }
}

export async function requestText(url: string, options: RequestOptions = {}): Promise<string> {
  const resp = await requestRaw(url, options)
  return resp.text()
}

export async function requestBuffer(url: string, options: RequestOptions = {}): Promise<Buffer> {
  const resp = await requestRaw(url, options)
  return Buffer.from(await resp.arrayBuffer())
}
