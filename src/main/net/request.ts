import { net } from 'electron'
import { createLogger } from '../core/logger'
import {
  DEFAULT_RETRY,
  HostGate,
  InflightMap,
  backoffDelay,
  coalesceKeyOf,
  isIdempotent,
  isRetriableStatus,
  parseRetryAfter,
  type RetryPolicy
} from './policy'
const log = createLogger('net')

/**
 * 主进程 HTTP 请求封装（音源用）。
 *
 * 走 Electron net.fetch（Chromium 网络栈）而非 Node 全局 fetch：
 * 前者遵循 net/proxy.ts 经 session.setProxy 应用的代理设置，后者完全无视——
 * 换用后音源接口（搜索/歌词/歌单）与取流、封面同一条代理路径，行为一致。
 *
 * 这一层只做 Electron 绑定；per-host 并发闸、重试退避、并发合并的纯逻辑在
 * net/policy.ts（可被 node --test 直接跑，见 tools/net.test.mjs）。
 *
 * 每个请求都受三重约束，缺一不可：
 * - **排队**：同 host 最多 DEFAULT_HOST_CONCURRENCY 个在飞。Chromium 每 host 只有 6 个
 *   socket，不排队的话超发的请求会在连接池里静默等待，而这段等待算在我们的 timeout 里
 *   （表现成「大歌单随机丢封面」），还会挤掉播放取流的额度。
 * - **超时**：覆盖「等响应头」+「读 body」两段。只掐前一段的话，上游半开连接会让
 *   await resp.text() 永久挂住，调用方的 catch 永远不执行。
 * - **重试**：仅幂等方法 + 可重试状态码，指数退避 + 满抖动。POST 不重放（qq/report.ts
 *   的上报会重复计数）。
 */

export interface RequestOptions {
  method?: string
  headers?: Record<string, string>
  query?: Record<string, string | number | boolean | undefined>
  /** 对象 → JSON；字符串/URLSearchParams/Buffer 原样发送（Buffer 用于 gzip 等二进制体） */
  body?: string | URLSearchParams | Buffer | Record<string, unknown>
  cookie?: string
  /** 整个请求（含读 body、含各次重试之间的退避）的总预算，默认 15s */
  timeout?: number
  /** 调用方的取消信号（下载暂停、切歌）。中止后不重试，直接抛。 */
  signal?: AbortSignal
  /** 覆盖重试策略；传 { attempts: 1, ... } 关掉重试 */
  retry?: Partial<RetryPolicy>
  /**
   * 关掉「同请求并发合并」。默认对无 cookie 的幂等请求开启：搜索框连打、多个列表同时
   * 渲染会打出完全相同的 GET，合并掉纯赚。需要每次都真实打一次（如轮询状态、埋点）时置 true。
   */
  noCoalesce?: boolean
}

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'

const DEFAULT_TIMEOUT = 15000

/** 接口请求的 per-host 闸门。取流不走这里（audio/protocol.ts 直接用 net.fetch），故留有额度。 */
const gate = new HostGate()
const inflight = new InflightMap()

/** 诊断用：各 host 的在飞/排队数（排查「请求变慢」先看这里有没有堆积） */
export function netStats(): { host: string; active: number; queued: number }[] {
  return gate.stats()
}

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

/** 请求整体被取消（调用方 signal），而非我们自己的超时/重试 */
export class RequestAbortedError extends Error {
  constructor() {
    super('请求已取消')
    this.name = 'RequestAbortedError'
  }
}

export class RequestTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`请求超时（${timeoutMs}ms）`)
    this.name = 'RequestTimeoutError'
  }
}

function isAbortError(e: unknown): boolean {
  return e instanceof Error && (e.name === 'AbortError' || e instanceof RequestAbortedError)
}

/** 可被 signal 打断的 sleep，用于重试退避（否则暂停下载后还要干等一轮退避） */
function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(new RequestAbortedError())
    }
    if (signal?.aborted) {
      clearTimeout(timer)
      reject(new RequestAbortedError())
      return
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * 请求的一次尝试。`deadline` 是绝对时刻（`Date.now()` 基准）：把它算在外面而不是每次
 * 尝试都重新给 15s，才能保证「总预算」这个语义 —— 否则 attempts=3 的请求最坏能等 45s。
 */
async function attemptFetch(
  url: string,
  init: { method: string; headers: Record<string, string>; body?: BodyInit },
  deadline: number,
  signal: AbortSignal | undefined
): Promise<Response> {
  const remaining = deadline - Date.now()
  if (remaining <= 0) throw new RequestTimeoutError(0)

  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, remaining)
  const onAbort = (): void => controller.abort()
  if (signal) {
    if (signal.aborted) {
      clearTimeout(timer)
      throw new RequestAbortedError()
    }
    signal.addEventListener('abort', onAbort, { once: true })
  }

  try {
    const resp = await net.fetch(url, { ...init, signal: controller.signal })
    // 控制器必须活过「等响应头」这一段，理由见 drainResponse：Electron 里只有 abort
    // 它才会真正拆掉 URLLoader、归还 socket。调用方的 signal 也继续挂着，这样流式
    // 消费者（下载暂停、切歌）取消时，连接同样收得回来。
    responseControllers.set(resp, controller)
    return resp
  } catch (e) {
    signal?.removeEventListener('abort', onAbort)
    // 区分三种中止：调用方取消 / 我们的超时 / 上游真错误。日志与重试决策都依赖它。
    if (signal?.aborted) throw new RequestAbortedError()
    if (timedOut) throw new RequestTimeoutError(remaining)
    throw e
  } finally {
    clearTimeout(timer)
  }
}

/** Response → 它背后那次 fetch 的控制器。只有 abort 它才能真正归还 socket。 */
const responseControllers = new WeakMap<Response, AbortController>()

/**
 * 收掉一条不打算再读的响应，归还那条连接。
 *
 * requestRaw 把「读 body」留给调用方，于是只看 `resp.ok`、`resp.status` 就走人的地方
 * （埋点上报、探活、失败后换链接重试、退避重试前丢弃的那次响应）会留下一条既没被读完
 * 也没被拆掉的响应。Chromium 会一直为它保留 socket：每主机 6 个额度、全进程 256 个。
 * 每播一首歌漏一条，放久了连取流都申请不到额度 —— 表现就是「任何歌曲都 upstream header
 * timeout，重启应用才恢复」。
 *
 * **只 `body.cancel()` 没用**：在 Electron 上实测过，取消响应体不会拆掉 URLLoader，
 * 那条 socket 照样挂在连接池里（三种收尾方式对照：什么都不做 / body.cancel / abort，
 * 只有最后一种让活连接归零、后续请求重新拿到额度）。所以这里必须 abort 那次 fetch 的
 * 控制器；`body.cancel()` 只是顺手把流也关掉。
 *
 * 重复调用安全；对已经读完的响应调用是空操作。
 */
export function drainResponse(resp: Response): void {
  responseControllers.get(resp)?.abort()
  void resp.body?.cancel().catch(() => {})
}

/** 内部别名：非 2xx 但可重试时，退避前先把这次响应收掉 */
const drain = drainResponse

function normalizeBody(
  options: RequestOptions,
  headers: Record<string, string>
): BodyInit | undefined {
  if (options.body == null) return undefined
  if (typeof options.body === 'string' || options.body instanceof URLSearchParams) {
    return options.body
  }
  if (Buffer.isBuffer(options.body)) {
    // 拷贝成独立 ArrayBuffer（Buffer 可能是池化切片，直接取 .buffer 会带上无关字节）
    return new Uint8Array(options.body).buffer as ArrayBuffer
  }
  headers['Content-Type'] ??= 'application/json'
  return JSON.stringify(options.body)
}

/**
 * 发一次请求，返回 Response（body 未读）。带排队、超时、重试。
 *
 * **注意**：返回值的 body 尚未读取，所以 `options.timeout` 只覆盖到响应头为止 ——
 * 剩下的预算管不到调用方自己读 body 的那段。需要完整超时保护的用
 * requestJson / requestText / requestBuffer，它们在同一个预算内把 body 读完。
 * 流式消费（下载、取流）本就该用 requestRaw + 自己的 signal。
 */
export async function requestRaw(url: string, options: RequestOptions = {}): Promise<Response> {
  const method = (options.method ?? 'GET').toUpperCase()
  const headers: Record<string, string> = { 'User-Agent': DEFAULT_UA, ...options.headers }
  if (options.cookie) headers['Cookie'] = options.cookie
  const body = normalizeBody(options, headers)
  const fullUrl = buildUrl(url, options.query)

  const policy: RetryPolicy = { ...DEFAULT_RETRY, ...options.retry }
  // 非幂等方法一律只发一次，无论调用方传了什么 attempts
  const attempts = isIdempotent(method) ? Math.max(1, policy.attempts) : 1
  const deadline = Date.now() + (options.timeout ?? DEFAULT_TIMEOUT)

  return await gate.run(fullUrl, async () => {
    let lastError: unknown
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const resp = await attemptFetch(
          fullUrl,
          { method, headers, body },
          deadline,
          options.signal
        )
        if (resp.ok) return resp

        if (attempt < attempts && isRetriableStatus(resp.status)) {
          // 服务端给了 Retry-After 就听它的，否则按指数退避
          const hinted = parseRetryAfter(resp.headers.get('retry-after'))
          const wait = hinted ?? backoffDelay(attempt, policy)
          drain(resp)
          // 退避会花掉预算，等不起就直接把这次响应交出去（由调用方判 !ok）
          if (Date.now() + wait >= deadline) {
            log.warn('HTTP 非成功响应（预算不足，不再重试）', {
              url: fullUrl,
              status: resp.status,
              attempt
            })
            return resp
          }
          log.warn('HTTP 非成功响应，退避重试', {
            url: fullUrl,
            status: resp.status,
            attempt,
            waitMs: wait
          })
          await delay(wait, options.signal)
          continue
        }

        log.warn('HTTP 非成功响应', { url: fullUrl, status: resp.status })
        return resp
      } catch (error) {
        // 调用方取消：立刻退出，不重试也不写 error 日志（这是预期路径）
        if (error instanceof RequestAbortedError || (options.signal?.aborted ?? false)) {
          throw new RequestAbortedError()
        }
        lastError = error
        if (attempt >= attempts) break
        const wait = backoffDelay(attempt, policy)
        if (Date.now() + wait >= deadline) break
        log.warn('网络请求失败，退避重试', { url: fullUrl, method, attempt, waitMs: wait, error })
        await delay(wait, options.signal)
      }
    }
    log.error('网络请求失败', lastError, { url: fullUrl, method, attempts })
    throw lastError
  })
}

/**
 * 在同一个超时预算内把 body 读完。
 *
 * 为什么必须自己掐这一段：requestRaw 的 AbortController 在拿到响应头后就随
 * attemptFetch 返回而失效了，此后 `resp.text()` 没有任何超时保护 —— 上游半开连接
 * （TCP 连着但不再发数据）会让它永久 pending，调用方的 catch 和 finally 都不会执行。
 */
async function readWithDeadline<T>(
  resp: Response,
  url: string,
  read: (r: Response) => Promise<T>,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  let onAbort: (() => void) | undefined
  try {
    return await new Promise<T>((resolve, reject) => {
      timer = setTimeout(() => {
        drain(resp)
        reject(new RequestTimeoutError(timeoutMs))
      }, timeoutMs)
      if (signal) {
        onAbort = () => {
          drain(resp)
          reject(new RequestAbortedError())
        }
        if (signal.aborted) {
          onAbort()
          return
        }
        signal.addEventListener('abort', onAbort, { once: true })
      }
      read(resp).then(resolve, reject)
    })
  } catch (error) {
    if (!isAbortError(error)) log.warn('读取响应体失败', { url, status: resp.status, error })
    // 半截 body（JSON 截断、上游中途断流）同样要收口，否则这条连接没人还
    drain(resp)
    throw error
  } finally {
    clearTimeout(timer)
    if (onAbort) signal?.removeEventListener('abort', onAbort)
  }
}

/**
 * 「发请求 + 读 body」的统一实现：排队、重试、总超时预算，外加同请求并发合并。
 *
 * 合并放在这一层而不是 requestRaw：Response 的 body 是一次性流，多个调用方共享同一个
 * Response 只有第一个能读到内容。这里共享的是**已读完的结果**，天然可以分发给所有等待者。
 */
async function requestBody<T>(
  url: string,
  options: RequestOptions,
  read: (r: Response) => Promise<T>
): Promise<T> {
  const method = (options.method ?? 'GET').toUpperCase()
  const totalTimeout = options.timeout ?? DEFAULT_TIMEOUT

  const run = async (): Promise<T> => {
    const deadline = Date.now() + totalTimeout
    const resp = await requestRaw(url, { ...options, timeout: totalTimeout })
    // 读 body 只能用掉预算的剩余部分，保证「总超时」名副其实
    const remaining = Math.max(1, deadline - Date.now())
    return await readWithDeadline(resp, url, read, remaining, options.signal)
  }

  if (options.noCoalesce) return await run()
  const bodyKey =
    typeof options.body === 'string'
      ? options.body
      : options.body instanceof URLSearchParams
        ? options.body.toString()
        : undefined
  const key = coalesceKeyOf(
    method,
    buildUrl(url, options.query),
    bodyKey,
    options.cookie,
    options.signal != null
  )
  // 不可合并（带 cookie / 带 signal / 非幂等 / body 无法作键）就各自发
  if (!key) return await run()
  return await inflight.run(key, run)
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
 *
 * 走 per-host 闸但**不重试**：调用方（crypto/netease.ts 的 eapi）在乎的是 set-cookie，
 * 重放登录类请求不安全。
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

  const fullUrl = buildUrl(url, options.query)
  const timeout = options.timeout ?? DEFAULT_TIMEOUT

  return await gate.run(fullUrl, async () => {
    return await new Promise<RawNodeResponse>((resolve, reject) => {
      const req = net.request({ method: options.method ?? 'GET', url: fullUrl })
      for (const [k, v] of Object.entries(headers)) req.setHeader(k, v)

      // settle 一次性闸：abort() 触发 'abort' 事件，若只监听 error 就会永久挂住
      // （'error' 不会为主动 abort 触发）—— 这里所有出口都收口到它。
      let settled = false
      const finish = (fn: () => void): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (onAbort) options.signal?.removeEventListener('abort', onAbort)
        fn()
      }

      const timer = setTimeout(() => {
        req.abort()
        finish(() => reject(new RequestTimeoutError(timeout)))
      }, timeout)

      let onAbort: (() => void) | undefined
      if (options.signal) {
        onAbort = () => {
          req.abort()
          finish(() => reject(new RequestAbortedError()))
        }
        if (options.signal.aborted) {
          clearTimeout(timer)
          reject(new RequestAbortedError())
          return
        }
        options.signal.addEventListener('abort', onAbort, { once: true })
      }

      // 主动 abort 走的是这条，不是 'error'
      req.on('abort', () => {
        finish(() => reject(new RequestAbortedError()))
      })
      req.on('response', (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => {
          finish(() =>
            resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) })
          )
        })
        res.on('error', (e: Error) => {
          log.warn('网络响应流失败', { url: fullUrl, error: e })
          finish(() => reject(e))
        })
      })
      req.on('error', (e: Error) => {
        log.warn('网络请求失败', { url: fullUrl, error: e })
        finish(() => reject(e))
      })
      if (body != null) req.write(body)
      req.end()
    })
  })
}

export async function requestJson<T>(url: string, options: RequestOptions = {}): Promise<T> {
  return await requestBody(url, options, (r) => r.json() as Promise<T>)
}

export async function requestText(url: string, options: RequestOptions = {}): Promise<string> {
  return await requestBody(url, options, (r) => r.text())
}

export async function requestBuffer(url: string, options: RequestOptions = {}): Promise<Buffer> {
  return await requestBody(url, options, async (r) => Buffer.from(await r.arrayBuffer()))
}
