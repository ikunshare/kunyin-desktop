/**
 * 取流的「空闲看门狗」+ 生命周期收口。
 *
 * 只用 Web Streams 与定时器，刻意不 import electron —— 和 net/policy.ts 一样，
 * 这样才能被 `node --test` 直接跑（见 tools/audioStream.test.mjs）。Electron 绑定在
 * audio/protocol.ts。
 *
 * 为什么必须有这一层：`protocol.handle` 的上游取流没有任何「读 body」的超时。上游
 * 半开（TCP 连着但不再发字节）时 `reader.read()` 会永久 pending，而它所在的异步生成器
 * （assembleRange/fetchAndStore）此刻**无法被取消**——`AsyncGenerator.return()` 会排在
 * 未决的 `next()` 之后，`finally` 里的 `reader.cancel()` 永远跑不到。于是那条上游连接
 * 永久留在 Chromium 连接池里，每 host 只有 6 个额度，攒满之后**每首歌**都只能排队等额度，
 * 表现就是「放久了之后任何歌曲都 upstream header timeout，重启才恢复」。
 *
 * 看门狗只在 `pull` 期间计时，所以 <audio> 缓冲满、暂停不读时不会误判：
 * 没人要数据的等待是我们自己的背压，不是上游停摆。
 */

/**
 * 上游在规定时间内一个字节都没给（区别于「等响应头超时」，那一段在 protocol.ts）。
 *
 * 字段用显式赋值而不是构造参数属性：本模块要被 `node --test` 的 strip-only
 * 类型擦除直接加载，参数属性在那里不支持（见 tools/ts-resolve.mjs）。
 */
export class StreamStallError extends Error {
  readonly idleMs: number
  constructor(idleMs: number) {
    super(`upstream stalled for ${idleMs}ms`)
    this.name = 'StreamStallError'
    this.idleMs = idleMs
  }
}

/** 流的终结原因：正常读完 / 下游取消 / 上游出错 / 空闲停摆 */
export type GuardSettleReason = 'end' | 'cancel' | 'error' | 'stall'

export interface GuardOptions {
  /** 多久读不到新数据就判定上游停摆（ms） */
  idleMs: number
  /** 流终结时**恰好调用一次**：用来 abort 上游连接、归还并发额度、记诊断 */
  onSettle?: (reason: GuardSettleReason) => void
  /** 每读到一块数据调用一次（诊断用：区分「连上了没数据」与「真在传」） */
  onData?: (bytes: number) => void
  /** 便于测试注入的定时器（默认 setTimeout/clearTimeout） */
  timers?: {
    set: (fn: () => void, ms: number) => unknown
    clear: (handle: unknown) => void
  }
}

const defaultTimers = {
  set: (fn: () => void, ms: number): unknown => setTimeout(fn, ms),
  clear: (handle: unknown): void => clearTimeout(handle as ReturnType<typeof setTimeout>)
}

/**
 * 给上游流套一层看门狗，返回一条语义等价、但**保证会终结**的流。
 *
 * - 读到数据 → onData，重新计时；
 * - idleMs 内没有任何数据 → 以 StreamStallError 终结，并先 onSettle('stall') 再
 *   cancel 上游（顺序很重要：onSettle 负责 abort 那条 fetch，pending 的 read 才会落地）；
 * - 下游取消 → onSettle('cancel') + 透传 cancel，连接立刻归还。
 */
export function guardStream(
  src: ReadableStream<Uint8Array>,
  opts: GuardOptions
): ReadableStream<Uint8Array> {
  const reader = src.getReader()
  const timers = opts.timers ?? defaultTimers
  let settled = false
  const settle = (reason: GuardSettleReason): void => {
    if (settled) return
    settled = true
    opts.onSettle?.(reason)
  }

  // highWaterMark: 0 不是调优，是**语义**：默认的 HWM=1 会让流自己预读一块，于是
  // 即便 <audio> 缓冲满了不再读，这里也始终挂着一次 pull —— 看门狗就会在暂停期间
  // 把一条健康连接判成停摆。HWM 为 0 时 pull 只在真有未决 read 时才被调用，
  // 「没人要数据的等待」自然不计时。
  return new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        let handle: unknown
        try {
          const result = await new Promise<{ done: boolean; value?: Uint8Array }>(
            (resolve, reject) => {
              handle = timers.set(() => reject(new StreamStallError(opts.idleMs)), opts.idleMs)
              reader.read().then(resolve, reject)
            }
          )
          if (result.done || !result.value) {
            settle('end')
            controller.close()
            return
          }
          opts.onData?.(result.value.byteLength)
          controller.enqueue(result.value)
        } catch (error) {
          settle(error instanceof StreamStallError ? 'stall' : 'error')
          // cancel 会让那条仍然 pending 的 read() 立刻以 {done:true} 落地，
          // 同时关掉 fetch body 背后的管道，Chromium 才会真正回收这个 socket。
          void reader.cancel(error).catch(() => {})
          controller.error(error)
        } finally {
          timers.clear(handle)
        }
      },
      cancel(reason) {
        settle('cancel')
        return reader.cancel(reason)
      }
    },
    { highWaterMark: 0 }
  )
}
