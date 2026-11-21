/**
 * 多连接分段下载（Range 并发）。
 *
 * 音源 CDN 大多**按连接限速**：单连接拉一首 HiRes / 一支 MV 只有几百 KB/s，同一文件开几条
 * Range 连接各拉一段，总速度基本按连接数翻倍。这里把一个文件切成定长分段，N 条连接各取各的，
 * 按绝对偏移写到落点（文件 / 内存都行，由调用方的 `write` 决定）。
 *
 * 和 net/policy.ts、audio/streamGuard.ts 一样**不 import electron**：怎么发请求（`open`）、
 * 怎么限并发（`gate`）、怎么归还连接（`release`）全由调用方注入，所以能被 `node --test` 直接跑
 * （tools/segmented.test.mjs）。Electron 绑定在调用处（modules/download、audio/appleMusic）。
 *
 * 几条不能省的约束：
 * - **先探后分**：第一条请求就带 `Range: bytes=0-<一段>`。回 206 且 Content-Range 给出总长才分段；
 *   回 200（服务端不认 Range）就把这条响应当整文件顺序读完——不会为了探测多打一次请求。
 * - **每段都核对 Content-Range 的起点**：服务端对后续分段忽略 Range 回了整文件的话，照着写就是
 *   把文件头盖到中段去，产物是坏的。对不上直接失败，不重试。
 * - **断点在段内续**：一段读到一半断了，重试从已写到的位置接着要，不重下整段。
 * - **许可要握到 body 读完**（`gate` 包住「发请求 + 读完这一段」）：只在等响应头期间握着的话，
 *   真正在飞的连接数没人管，照样把 Chromium 每主机 6 个 socket 打满、挤掉播放取流。
 * - 读 body 必须过空闲看门狗，且非正常结束时要 `release`（= abort 那次 fetch）：
 *   只 cancel body 在 Electron 上不归还 socket（见 CLAUDE.md「取流连接的生命周期」）。
 */
import { guardStream } from '../audio/streamGuard'

/** 上游给出的明确拒绝（直链过期、鉴权失败）。重试同一个请求没有意义，直接上抛。 */
export class HttpStatusError extends Error {
  readonly status: number
  constructor(status: number) {
    super(`HTTP ${status}`)
    this.name = 'HttpStatusError'
    this.status = status
  }
}

/** 分段请求没有按要求的起点返回（服务端中途改口不认 Range）。照写会写坏文件，不重试。 */
export class RangeMismatchError extends Error {
  constructor(expected: number, got: string) {
    super(`分段响应与请求不符（期望起点 ${expected}，实际 ${got}）`)
    this.name = 'RangeMismatchError'
  }
}

export interface SegmentedOptions {
  /**
   * 发一次请求。`range` 为 null 表示要整文件。必须把 `signal` 一路挂到连接上：
   * abort 它要能掐断**读 body 阶段**的连接（requestRaw 满足）。
   */
  open: (range: string | null, signal: AbortSignal) => Promise<Response>
  /** 把一块数据写到绝对偏移 position。同一时刻会有多个分段并发调用，落点各不相交。 */
  write: (data: Uint8Array, position: number) => Promise<void>
  /** 并发闸：包住「一个分段从发请求到读完」。默认不限。 */
  gate?: <T>(task: () => Promise<T>) => Promise<T>
  /** 收掉一条不再读的响应（drainResponse）。默认只 cancel body。 */
  release?: (resp: Response) => void
  signal?: AbortSignal
  /** 分段大小（字节），默认 1 MiB */
  segmentSize?: number
  /** 并发连接数，默认 4 */
  connections?: number
  /** 读 body 的空闲上限（ms），默认 20s */
  idleMs?: number
  /** 单个分段连续失败几次后放弃（期间只要有进展就清零），默认 3 */
  retries?: number
  /** 重试前的等待（ms），默认 500 */
  retryDelayMs?: number
  /** 得知总长时调用一次（分段模式必有；整文件模式仅当服务端给了 Content-Length） */
  onSize?: (total: number) => void
  /** 每写下一块调用一次，参数是这一块的字节数 */
  onProgress?: (bytes: number) => void
}

export interface SegmentedResult {
  /** 实际写下的总字节数 */
  size: number
  /** 是否走了多连接分段（false = 服务端不认 Range，单连接顺序读完的） */
  segmented: boolean
}

/**
 * 1 MiB：分段是「一个请求取一段」，段太大时小文件分不匀——12MB 按 2MiB 切只有 6 段，4 条连接
 * 要跑两整轮，实测比 1MiB 慢四成。再小就是请求数白涨（连接是 keep-alive 复用的，每段多一个 RTT）。
 */
export const DEFAULT_SEGMENT_SIZE = 1024 * 1024
export const DEFAULT_CONNECTIONS = 4

/** 解析 `Content-Range: bytes S-E/TOTAL`；TOTAL 为 `*` 时 total = 0。 */
export function parseContentRange(
  value: string | null | undefined
): { start: number; end: number; total: number } | null {
  if (!value) return null
  const m = /bytes\s+(\d+)-(\d+)\/(\d+|\*)/i.exec(value)
  if (!m) return null
  const start = Number(m[1])
  const end = Number(m[2])
  const total = m[3] === '*' ? 0 : Number(m[3])
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null
  return { start, end, total: Number.isFinite(total) ? total : 0 }
}

function abortError(): Error {
  const error = new Error('下载已取消')
  error.name = 'AbortError'
  return error
}

export async function downloadSegmented(opts: SegmentedOptions): Promise<SegmentedResult> {
  const segmentSize = Math.max(64 * 1024, opts.segmentSize ?? DEFAULT_SEGMENT_SIZE)
  const connections = Math.max(1, opts.connections ?? DEFAULT_CONNECTIONS)
  const idleMs = opts.idleMs ?? 20_000
  const retries = Math.max(0, opts.retries ?? 3)
  const retryDelayMs = opts.retryDelayMs ?? 500
  const gate = opts.gate ?? (<T>(task: () => Promise<T>): Promise<T> => task())
  const release =
    opts.release ?? ((resp: Response): void => void resp.body?.cancel().catch(() => {}))

  // 自己的闸：任何一段彻底失败都要把其余在飞的分段一起掐掉，不能只靠调用方的 signal
  const abort = new AbortController()
  const onOuterAbort = (): void => abort.abort()
  if (opts.signal?.aborted) throw abortError()
  opts.signal?.addEventListener('abort', onOuterAbort, { once: true })

  const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      const done = (): void => {
        clearTimeout(timer)
        abort.signal.removeEventListener('abort', done)
        resolve()
      }
      const timer = setTimeout(done, ms)
      abort.signal.addEventListener('abort', done, { once: true })
    })

  /**
   * 把响应体写到 state.cur 起、至多到 end（闭区间）。state.cur 随写随进，
   * 中途抛错时调用方据此从断点续。读到 EOF 才算正常结束——恰好读满就撒手的话，
   * 那条连接是被 cancel 掉的，没法复用。
   */
  const pipe = async (resp: Response, state: { cur: number }, end: number): Promise<void> => {
    const guarded = guardStream(resp.body as ReadableStream<Uint8Array>, {
      idleMs,
      // 读完的连接留给连接池复用；其余情况（停摆 / 出错 / 提前撒手）必须 abort 才还得回去
      onSettle: (reason) => {
        if (reason !== 'end') release(resp)
      }
    })
    const reader = guarded.getReader()
    let finished = false
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done || !value) {
          finished = true
          return
        }
        const room = end - state.cur + 1
        // 服务端多给了：到此为止（finally 里 cancel）
        if (room <= 0) return
        const chunk = value.byteLength > room ? value.subarray(0, room) : value
        await opts.write(chunk, state.cur)
        state.cur += chunk.byteLength
        opts.onProgress?.(chunk.byteLength)
      }
    } finally {
      if (!finished) void reader.cancel().catch(() => {})
    }
  }

  /** 取 [start, end] 这一段，失败从断点续，直到取满或重试用尽。 */
  const runSegment = async (start: number, end: number): Promise<void> => {
    const state = { cur: start }
    let failures = 0
    while (state.cur <= end) {
      if (abort.signal.aborted) throw abortError()
      const before = state.cur
      try {
        await gate(async () => {
          if (abort.signal.aborted) throw abortError()
          const resp = await opts.open(`bytes=${state.cur}-${end}`, abort.signal)
          if (!resp.ok || !resp.body) {
            release(resp)
            throw new HttpStatusError(resp.status)
          }
          const cr = parseContentRange(resp.headers.get('content-range'))
          if (resp.status !== 206 || !cr || cr.start !== state.cur) {
            release(resp)
            throw new RangeMismatchError(
              state.cur,
              `${resp.status} ${resp.headers.get('content-range') ?? '无 Content-Range'}`
            )
          }
          await pipe(resp, state, end)
        })
        if (state.cur <= end) throw new Error('分段响应提前结束')
      } catch (error) {
        if (abort.signal.aborted) throw abortError()
        if (error instanceof HttpStatusError || error instanceof RangeMismatchError) throw error
        if (state.cur > before) failures = 0
        if (++failures > retries) throw error
        await sleep(retryDelayMs)
      }
    }
  }

  type Probe =
    { segmented: true; total: number; reached: number } | { segmented: false; size: number }

  /** 分段模式下总长一到手就放行其余连接，不必等第一段读完 */
  let announce!: (total: number) => void
  const layout = new Promise<number>((resolve) => {
    announce = resolve
  })

  const probe = gate(async (): Promise<Probe> => {
    if (abort.signal.aborted) throw abortError()
    let resp = await opts.open(`bytes=0-${segmentSize - 1}`, abort.signal)
    if (!resp.ok || !resp.body) {
      release(resp)
      throw new HttpStatusError(resp.status)
    }
    const cr = parseContentRange(resp.headers.get('content-range'))
    if (resp.status === 206 && cr && cr.start === 0 && cr.total > 0) {
      opts.onSize?.(cr.total)
      announce(cr.total)
      const state = { cur: 0 }
      try {
        await pipe(resp, state, Math.min(segmentSize, cr.total) - 1)
      } catch {
        if (abort.signal.aborted) throw abortError()
        // 第一段断在半路：剩下的交给 runSegment 续（它自带重试），这里不算失败
      }
      return { segmented: true, total: cr.total, reached: state.cur }
    }

    // 不认 Range。206 却拿不到总长的怪响应不能当整文件用，重新要一次不带 Range 的
    if (resp.status === 206) {
      release(resp)
      resp = await opts.open(null, abort.signal)
      if (!resp.ok || !resp.body) {
        release(resp)
        throw new HttpStatusError(resp.status)
      }
    }
    announce(0)
    const length = Number(resp.headers.get('content-length')) || 0
    if (length > 0) opts.onSize?.(length)
    const state = { cur: 0 }
    await pipe(resp, state, Number.MAX_SAFE_INTEGER)
    if (length > 0 && state.cur < length) throw new Error('响应提前结束')
    return { segmented: false, size: state.cur }
  })
  // probe 抛错时 layout 也得落地，否则下面的 await 永远等不到
  probe.catch(() => announce(0))

  try {
    const total = await layout
    if (total <= 0) {
      const result = await probe
      // 走到这里只可能是整文件模式（分段模式 total 必 > 0）
      return { size: result.segmented ? result.total : result.size, segmented: false }
    }

    const queue: [number, number][] = []
    for (let start = segmentSize; start < total; start += segmentSize) {
      queue.push([start, Math.min(total, start + segmentSize) - 1])
    }
    const drainQueue = async (): Promise<void> => {
      for (;;) {
        const job = queue.shift()
        if (!job) return
        await runSegment(job[0], job[1])
      }
    }
    const firstEnd = Math.min(segmentSize, total) - 1
    const workers: Promise<void>[] = [
      // 读第一段的那条连接读完后并入工作池
      (async () => {
        const first = await probe
        if (first.segmented && first.reached <= firstEnd) await runSegment(first.reached, firstEnd)
        await drainQueue()
      })()
    ]
    for (let i = 1; i < connections; i++) workers.push(drainQueue())
    try {
      await Promise.all(workers)
    } catch (error) {
      abort.abort()
      await Promise.allSettled(workers)
      throw error
    }
    return { size: total, segmented: true }
  } finally {
    opts.signal?.removeEventListener('abort', onOuterAbort)
  }
}
