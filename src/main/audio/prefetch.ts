/**
 * 播放预取的调度器：用几条并发连接把一首歌缺的缓存块提前拉完。
 *
 * 为什么需要它：`kunyin://` 的取流是**被 `<audio>` 的背压牵着走**的单连接——Chromium 缓冲够了就
 * 不再读，那条上游连接随之停住。于是一首歌的下载被拉长到和播放一样久，这期间上游任何一次抖动
 * （CDN 按连接限速、半开停摆要等 20s 看门狗、空闲太久被对端掐断后重连）都直接变成播放卡顿；
 * seek 到没放过的位置更是每次都要现开连接。预取与播放进度脱钩：开播后几秒内把整首拉进分块缓存，
 * 此后的播放与 seek 全是本地读。
 *
 * 这里只有调度（挑哪一块、几条并发、失败几次收手），**不 import electron**：真正取块落盘的
 * `fetchBlock` 由 audio/protocol.ts 注入，所以能被 `node --test` 直接跑（tools/prefetch.test.mjs）。
 *
 * 挑块顺序跟着读者走：先读者后面的块（马上要用），再绕回前面的（seek 回去才用），读者正在读的那
 * 一块留到最后——它由播放那条连接自己在下，抢着下只是重复流量。
 */

/** 这一路不必再试的失败（直链过期、上游不认 Range）：立刻收手，不计入重试。 */
export class PrefetchFatalError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PrefetchFatalError'
  }
}

export type PrefetchSettleReason = 'complete' | 'stopped' | 'failed'

export interface PrefetchOptions {
  blockCount: number
  /** 第 index 块是否已在缓存里 */
  has: (index: number) => boolean
  /**
   * 取一块并落盘。true = 这一块现在在缓存里了；false / 抛普通错误 = 这次没成（会重试）；
   * 抛 PrefetchFatalError = 整路收手。必须响应 signal。
   */
  fetchBlock: (index: number, signal: AbortSignal) => Promise<boolean>
  /** 并发连接数，默认 3 */
  connections?: number
  /** 建立后等多久才开工（ms），默认 0。连点下一首时，被跳过的歌不该白开几条连接。 */
  startDelayMs?: number
  /** 连续失败多少次判定这一路不通（成功一次清零），默认 3 */
  maxFailures?: number
  /** 失败后的等待（ms），默认 500 */
  retryDelayMs?: number
  /** 终结时恰好调用一次 */
  onSettle?: (reason: PrefetchSettleReason, error?: unknown) => void
}

export class PrefetchSession {
  private readonly opts: PrefetchOptions
  private readonly abort = new AbortController()
  /** 正在取的块 → 这一次尝试的 Promise（无论成败都会落地，不 reject） */
  private readonly inflight = new Map<number, Promise<void>>()
  private reader = 0
  private failures = 0
  private fatal: unknown = undefined
  private failed = false
  private done = false
  private timer: ReturnType<typeof setTimeout> | null

  constructor(opts: PrefetchOptions) {
    this.opts = opts
    this.timer = setTimeout(() => {
      this.timer = null
      this.launch()
    }, opts.startDelayMs ?? 0)
  }

  /** 已终结（拉完 / 被停 / 失败） */
  get settled(): boolean {
    return this.done
  }

  /** 读者当前读到第几块。挑块顺序跟着它走。 */
  hint(block: number): void {
    if (Number.isFinite(block)) this.reader = Math.max(0, Math.floor(block))
  }

  /** 这一块是否正在取 */
  pending(block: number): boolean {
    return this.inflight.has(block)
  }

  /** 这一块正在取的话，给出它这次尝试的 Promise（成败都 resolve）；否则 null。 */
  wait(block: number): Promise<void> | null {
    return this.inflight.get(block) ?? null
  }

  stop(): void {
    if (this.done) return
    this.abort.abort()
    if (this.timer) {
      // 还没开工：没有工人会来收尾，自己终结
      clearTimeout(this.timer)
      this.timer = null
      this.settle('stopped')
    }
  }

  private settle(reason: PrefetchSettleReason): void {
    if (this.done) return
    this.done = true
    this.opts.onSettle?.(reason, this.fatal)
  }

  /** 下一块该取谁；-1 = 没有可取的了（全在缓存里，或剩下的都有人在取） */
  private pick(): number {
    const n = this.opts.blockCount
    if (n <= 0) return -1
    const r = Math.min(this.reader, n - 1)
    // k = 1..n-1 依次是读者之后的块、再绕回读者之前的块；k = n 才轮到读者自己那块
    for (let k = 1; k <= n; k++) {
      const i = (r + k) % n
      if (!this.opts.has(i) && !this.inflight.has(i)) return i
    }
    return -1
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const signal = this.abort.signal
      const done = (): void => {
        clearTimeout(timer)
        signal.removeEventListener('abort', done)
        resolve()
      }
      const timer = setTimeout(done, ms)
      signal.addEventListener('abort', done, { once: true })
    })
  }

  private launch(): void {
    if (this.abort.signal.aborted) {
      this.settle('stopped')
      return
    }
    const count = Math.max(1, this.opts.connections ?? 3)
    const workers = Array.from({ length: count }, () => this.work())
    void Promise.all(workers).then(() => {
      this.settle(this.failed ? 'failed' : this.abort.signal.aborted ? 'stopped' : 'complete')
    })
  }

  private async work(): Promise<void> {
    const signal = this.abort.signal
    const maxFailures = Math.max(1, this.opts.maxFailures ?? 3)
    for (;;) {
      if (signal.aborted) return
      const index = this.pick()
      if (index < 0) return
      let ok = false
      const attempt = (async (): Promise<void> => {
        try {
          ok = await this.opts.fetchBlock(index, signal)
        } catch (error) {
          if (error instanceof PrefetchFatalError) {
            this.fatal = error
            this.failed = true
            this.abort.abort()
          }
        }
      })()
      this.inflight.set(index, attempt)
      await attempt
      this.inflight.delete(index)
      if (signal.aborted) return
      if (ok) {
        this.failures = 0
        continue
      }
      if (++this.failures >= maxFailures) {
        this.failed = true
        this.abort.abort()
        return
      }
      await this.sleep(this.opts.retryDelayMs ?? 500)
    }
  }
}
