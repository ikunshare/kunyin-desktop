/**
 * 给 `Readable.toWeb` 转出来的流套一层「推迟落地的 cancel」。net.fetch 的响应体就是这种流：
 * Electron 把 IncomingMessage 经 Node 的 `Readable.toWeb` 转成 Response.body；本地文件那几处
 * `Readable.toWeb(createReadStream())` 同理。
 *
 * Node 24 的这个适配器有个竞态（Electron 44 内置的 Node 24.18 与 Node 24.20 都实测复现）：
 * web 流被 cancel 的那一刻，Node 流里还压着缓冲数据、且上一次 pull 排进 nextTick 的 resume 还没跑，
 * 那么 resume 一跑，适配器的 onData 就往已关闭的 controller 里 enqueue，抛
 * `ERR_INVALID_STATE: Controller is already closed`。它是从事件回调里抛出来的，没有任何
 * try/catch 接得住，就是一条主进程未捕获异常。
 * - 读者正在读的时候收手最容易撞上：刚读完一块（这一读触发了 pull → resume 排队），同一轮里就
 *   cancel——预取追上读者、读者在块边界交还连接（protocol.ts 的 pumpUpstream）就是这样。
 * - 「先 abort 再 cancel」在同一轮里做也一样会撞：abort 让 Electron destroy 那个 IncomingMessage，
 *   但它的 'close' 要到 nextTick 才发，在那之前排队的 resume 照样吐数据。
 * - 只 destroy（只 abort）不 cancel 是安全的：适配器在 'close' 上自己收尾。
 *
 * 所以这里：cancel 时先同步调 onCancel（abort 那次 fetch，连接立刻归还——取消语义不变），
 * 真正的 cancel 推迟到下一个宏任务。那时排进 nextTick 的 resume 一定已经跑完，而 cancel 之后
 * 这层不会再去读它，也就不会再有新的 resume 排队。
 *
 * 读取原样透传。highWaterMark 0：只在下游真要数据时才读上游，不多攒一块，
 * 背压与不套这层时一致（streamGuard 的空闲计时依赖这一点）。
 *
 * 不 import electron，tools/fetchBody.test.mjs 直接跑。
 */

export interface DeferCancelOptions {
  /** cancel 时同步调用、恰好一次（net.fetch：abort 那次请求才会归还 socket） */
  onCancel?: () => void
  /** 便于测试注入；默认 setImmediate（下一个宏任务） */
  defer?: (fn: () => void) => void
}

export function deferCancel(
  src: ReadableStream<Uint8Array>,
  opts: DeferCancelOptions = {}
): ReadableStream<Uint8Array> {
  const reader = src.getReader()
  const defer = opts.defer ?? ((fn: () => void): void => void setImmediate(fn))
  let cancelled = false
  return new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        try {
          const { done, value } = await reader.read()
          // cancel 之后落地的读：流已经关了，结果扔掉
          if (cancelled) return
          if (done) controller.close()
          else controller.enqueue(value)
        } catch (e) {
          if (!cancelled) controller.error(e)
        }
      },
      cancel(reason) {
        cancelled = true
        opts.onCancel?.()
        defer(() => void reader.cancel(reason).catch(() => {}))
      }
    },
    { highWaterMark: 0 }
  )
}

/**
 * 同上，作用在 Response 上：换成一个 body 套了 deferCancel 的 Response（状态与头原样）。
 * 没有 body 的（204 / 304 / HEAD）原样返回。
 */
export function withDeferredCancel(resp: Response, onCancel?: () => void): Response {
  if (!resp.body) return resp
  return new Response(deferCancel(resp.body as ReadableStream<Uint8Array>, { onCancel }), {
    status: resp.status,
    statusText: resp.statusText,
    headers: resp.headers
  })
}
