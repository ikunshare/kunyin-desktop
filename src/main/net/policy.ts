/**
 * 网络策略层：per-host 并发闸、重试退避、并发请求合并。
 *
 * 刻意不 import electron —— 这里全是纯逻辑，所以能被 `node --test` 直接跑
 * （见 tools/net.test.mjs）。Electron 绑定在 net/request.ts。
 *
 * 为什么需要 per-host 闸：Chromium 每个主机只给 6 个并发 socket，超出的请求在
 * 连接池里静默排队。这对我们有两个坏处——
 * 1. 排队时间算在我们的 timeout 里：一次 50 首歌的封面补全（qq/cover.ts）能让后发的
 *    请求还没拿到 socket 就先超时，表现成「随机丢封面」；
 * 2. 取流也走同一个池（audio/protocol.ts 的注释记了这个坑），接口洪峰会挤掉播放。
 * 在应用层排队后，超时只覆盖真正在飞的那段，且能给取流留出额度。
 */

/** Chromium per-host socket 上限。应用层闸门必须严格小于它，才能给取流留额度。 */
export const CHROMIUM_PER_HOST_SOCKETS = 6

/** 接口类请求的 per-host 并发上限（留 2 个额度给取流/封面图片直连）。 */
export const DEFAULT_HOST_CONCURRENCY = 4

/** 从 URL 取并发闸的键。解析不了就退化成整条 URL（宁可各自排队，也不要全挤成一个键）。 */
export function hostKeyOf(url: string): string {
  try {
    const u = new URL(url)
    // 端口纳入键：Chromium 的连接池也是按 (scheme, host, port) 分的
    return `${u.protocol}//${u.host}`
  } catch {
    return url
  }
}

/**
 * per-host 并发闸。每个 host 一个 FIFO 队列，同一 host 最多 limit 个请求在飞。
 *
 * 许可（permit）在释放时**直接转交**给队首等待者，`active` 不回落。这不是为了修某个
 * 竞态（唤醒排的微任务一定先于任何能观察到本次释放的代码，JS 单线程下「先 active--
 * 再唤醒」同样不会超发），而是为了让不变量简单到不必推敲调度：`active` 恒等于持有
 * 许可的任务数，于是「队列非空时 active 必然 > 0」自动成立，条目回收的判断（见下）
 * 不会误删还有等待者的 lane。
 */
export class HostGate {
  private readonly limit: number
  /** host → 当前持有许可数 + 等待队列 */
  private readonly lanes = new Map<string, { active: number; waiters: (() => void)[] }>()

  constructor(limit: number = DEFAULT_HOST_CONCURRENCY) {
    this.limit = Math.max(1, limit)
  }

  async run<T>(url: string, task: () => Promise<T>): Promise<T> {
    const key = hostKeyOf(url)
    let lane = this.lanes.get(key)
    if (!lane) {
      lane = { active: 0, waiters: [] }
      this.lanes.set(key, lane)
    }
    const held = lane

    if (held.active >= this.limit) {
      // 醒来即持有许可（上一个持有者转交的），不再自增
      await new Promise<void>((resolve) => held.waiters.push(resolve))
    } else {
      held.active++
    }

    try {
      return await task()
    } finally {
      const next = held.waiters.shift()
      if (next) {
        next() // 许可转交，active 不变
      } else {
        held.active--
        // 无人持有也无人排队：删掉条目，避免长跑进程里 Map 无限增长
        if (held.active === 0) this.lanes.delete(key)
      }
    }
  }

  /** 诊断用：当前各 host 的在飞/排队数 */
  stats(): { host: string; active: number; queued: number }[] {
    return [...this.lanes].map(([host, l]) => ({
      host,
      active: l.active,
      queued: l.waiters.length
    }))
  }
}

// ============ 重试 ============

export interface RetryPolicy {
  /** 最多尝试几次（含首次）。1 = 不重试。 */
  attempts: number
  /** 首次退避毫秒，之后指数翻倍 */
  baseDelayMs: number
  /** 退避上限，防止 attempts 调大后等到天荒地老 */
  maxDelayMs: number
}

export const DEFAULT_RETRY: RetryPolicy = { attempts: 3, baseDelayMs: 300, maxDelayMs: 4000 }

/** 只有幂等方法能安全重试：POST 重放可能造成重复上报/重复下单 */
export function isIdempotent(method: string): boolean {
  const m = method.toUpperCase()
  return m === 'GET' || m === 'HEAD' || m === 'OPTIONS'
}

/**
 * 该状态码值不值得重试。
 * 429（限流）与 5xx（服务端抖动）值得；4xx 其余是我们自己的问题，重试只是浪费额度。
 * 501/505 是「服务端不支持」，重试同样没意义。
 */
export function isRetriableStatus(status: number): boolean {
  if (status === 429) return true
  if (status === 501 || status === 505) return false
  return status >= 500
}

/**
 * 退避时长。指数增长 + 满抖动（full jitter）：多首歌同时失败时错开重试，
 * 不然它们会整齐地一起再撞一次上游。rng 参数化只为测试可复现。
 */
export function backoffDelay(
  attempt: number,
  policy: RetryPolicy = DEFAULT_RETRY,
  rng: () => number = Math.random
): number {
  const exp = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** Math.max(0, attempt - 1))
  return Math.round(exp * rng())
}

/**
 * 解析 Retry-After（秒数或 HTTP 日期两种形式，RFC 9110）。
 * 服务端明确说了等多久就听它的，比我们自己猜的退避准。返回 null = 没有可用值。
 * 上限 30s：见过上游回几小时的 Retry-After，照做等于把请求永久挂死。
 */
export function parseRetryAfter(value: string | null | undefined, now = Date.now()): number | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null

  const MAX = 30_000
  if (/^\d+$/.test(trimmed)) {
    return Math.min(MAX, Number(trimmed) * 1000)
  }
  const at = Date.parse(trimmed)
  if (Number.isNaN(at)) return null
  return Math.min(MAX, Math.max(0, at - now))
}

// ============ 并发合并 ============

/**
 * 同 key 的并发调用合并成一次真实请求（in-flight coalescing）。
 *
 * 与 providers/discovery.ts 的 `cached()` 不同：这里**不做 TTL 缓存**，只在「请求还在飞」
 * 的窗口内共享。搜索框连打、列表重复渲染会打出同一个请求，合并掉纯赚；而一旦返回就
 * 立刻忘掉，语义上等价于没有缓存，不会让调用方读到过期数据。
 */
export class InflightMap {
  private readonly map = new Map<string, Promise<unknown>>()

  run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const pending = this.map.get(key)
    if (pending) return pending as Promise<T>
    // 注意：task() 可能同步抛，用 Promise.resolve().then 包一层保证拿到 Promise
    const task$ = Promise.resolve()
      .then(task)
      .finally(() => this.map.delete(key))
    this.map.set(key, task$)
    return task$
  }

  size(): number {
    return this.map.size
  }
}

/**
 * 合并键。返回 null = 不可合并。
 *
 * 排除三类：
 * - 带 cookie：登录态不同，结果不同；
 * - 非幂等方法：见 isIdempotent；
 * - **带 signal**：合并后共享同一个 Promise，任一调用方取消会把取消错误抛给所有等待者
 *   （B 明明没取消却收到 RequestAbortedError）。可取消的请求各发各的。
 */
export function coalesceKeyOf(
  method: string,
  url: string,
  body: string | undefined,
  cookie: string | undefined,
  hasSignal = false
): string | null {
  if (cookie) return null
  if (hasSignal) return null
  if (!isIdempotent(method)) return null
  return `${method.toUpperCase()} ${url}${body ? `\n${body}` : ''}`
}
