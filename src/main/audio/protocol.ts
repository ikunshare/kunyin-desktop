/**
 * 自定义协议音频流 `kunyin://`（替代 127.0.0.1 HTTP 代理）。
 *
 * 相比开本地端口：不占 TCP 端口、不暴露给其它进程、生命周期随 app、CSP 只需放行 scheme。
 * protocol.handle 收到 <audio> 的请求（含 Range），向上游取流、必要时边下边解密（QQ mflac ekey），
 * 返回带 Content-Range 的 Response——媒体 seek 靠 206 分段。
 *
 * 用法：
 * - 主进程 app ready 前调 registerAudioScheme()（注册特权 scheme）；
 * - app ready 后调 installAudioProtocol()（挂 handler）；
 * - 业务侧 registerAudioStream(spec) 拿 `kunyin://stream/<token>` 喂 <audio>。
 */
import { protocol, net, session } from 'electron'
import { randomBytes } from 'node:crypto'
import { createReadStream, statSync } from 'node:fs'
import { extname } from 'node:path'
import { Readable } from 'node:stream'
import type { AudioCipher } from '@common'
import { cipherHeaderSize, createAudioDecryptor, type AudioDecryptor } from '../crypto/decryptor'

export interface AudioStreamSpec {
  /** 远程直链；与 filePath 二选一 */
  url?: string
  /** 本地音频文件绝对路径（「添加本地歌曲」），直接 fs 流式读取 */
  filePath?: string
  /** 上游请求头（Referer/UA/Cookie 等） */
  headers?: Record<string, string>
  /** 加密流的 ekey，非空时边下边解密（算法由 cipher 指定，缺省 QQ mflac） */
  ekey?: string
  cipher?: AudioCipher
  contentType?: string
}

/** 本地文件扩展名 → Content-Type（<audio> 靠它选解码器） */
const LOCAL_MIME: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.wma': 'audio/x-ms-wma',
  '.ape': 'audio/x-ape'
}

/** 本地文件响应：fs.createReadStream + 手工 206 Range（seek 全靠它） */
function serveLocalFile(filePath: string, range: string | null): Response {
  let size: number
  try {
    size = statSync(filePath).size
  } catch {
    return new Response(null, { status: 404 })
  }
  const mime = LOCAL_MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
  let start = 0
  let end = size - 1
  let status = 200
  const headers = new Headers({
    'Accept-Ranges': 'bytes',
    'Content-Type': mime
  })
  const m = range ? /bytes=(\d+)-(\d*)/.exec(range) : null
  if (m) {
    start = parseInt(m[1], 10)
    if (m[2]) end = Math.min(parseInt(m[2], 10), size - 1)
    if (start >= size) {
      headers.set('Content-Range', `bytes */${size}`)
      return new Response(null, { status: 416, headers })
    }
    status = 206
    headers.set('Content-Range', `bytes ${start}-${end}/${size}`)
  }
  headers.set('Content-Length', String(end - start + 1))
  const body = Readable.toWeb(
    createReadStream(filePath, { start, end })
  ) as ReadableStream<Uint8Array>
  return new Response(body as BodyInit, { status, headers })
}

const SCHEME = 'kunyin'
const MAX_ENTRIES = 64
const registry = new Map<string, AudioStreamSpec>()

/**
 * 等响应头的超时（ms）。只覆盖「建连 + 收到响应头」这一段，不限制后续流式传输，
 * 否则长音频播到一半会被掐断。
 *
 * 没有它的话：上游 CDN 挂住连接却不响应时 net.fetch 的 await 永不落地，
 * handler 永不返回，DevTools 里那条请求就永远停在「待处理」，播放彻底卡死。
 */
const UPSTREAM_HEADER_TIMEOUT = 15_000

/**
 * 快速失败且值得重试的网络错误：多见于 VPN/代理切换节点、Wi-Fi 切换的瞬间，
 * Chromium 会把在飞请求判死（ERR_NETWORK_CHANGED），等网络落定后重发一般就通。
 */
const RETRYABLE_NET_ERRORS = [
  'ERR_NETWORK_CHANGED',
  'ERR_CONNECTION_RESET',
  'ERR_CONNECTION_CLOSED'
]
/** 网络抖动重试前的等待（ms）：给系统留出路由/适配器切换完成的时间 */
const NET_RETRY_DELAY = 800

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** 等响应头超时。单独建类型：它和 RETRYABLE_NET_ERRORS 一样值得清池重试，但对外要报 504 而非 502。 */
class HeaderTimeoutError extends Error {
  constructor() {
    super('upstream header timeout')
    this.name = 'HeaderTimeoutError'
  }
}

/**
 * 清空 session 连接池——等价于「重启应用」对网络栈的那部分效果。
 * 网络切换（VPN 换节点/切 Wi-Fi）后，池里残留的半死连接会占满对同一 CDN 域名的并发额度，
 * 新请求排队等不到 socket，表现为清一色的响应头超时，且不重启不会自愈。
 * 多路流同时超时会并发触发清池，这里合并成一次——否则 A 的清池会把 B 刚发出的重试也杀掉。
 */
let flushPromise: Promise<void> | null = null
let lastFlushAt = 0
function flushConnectionPool(): Promise<void> {
  const now = Date.now()
  if (flushPromise && now - lastFlushAt < 5_000) return flushPromise
  lastFlushAt = now
  flushPromise = session.defaultSession.closeAllConnections()
  return flushPromise
}

function isRetryable(e: unknown): boolean {
  if (e instanceof HeaderTimeoutError) return true
  const msg = e instanceof Error ? e.message : String(e)
  return RETRYABLE_NET_ERRORS.some((code) => msg.includes(code))
}

/**
 * 单次上游取流，带「等响应头」超时：
 * - rendererSignal（<audio> 的取消）必须联动到上游，否则 seek/换歌后主进程侧连接
 *   继续在后台拉完整个文件，孤儿连接攒满连接池后新请求就发不出去；
 * - 超时只掐「等响应头」这一段，拿到响应头后立刻解除，不影响后面的流式传输——
 *   否则长音频播到一半会被掐断；
 * - once：监听器随请求对象一起回收，不必手动摘（摘了传输阶段就断不掉上游）。
 */
async function fetchUpstreamOnce(
  url: string,
  headers: Record<string, string>,
  rendererSignal: AbortSignal
): Promise<Response> {
  const abort = new AbortController()
  rendererSignal.addEventListener('abort', () => abort.abort(), { once: true })
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    abort.abort()
  }, UPSTREAM_HEADER_TIMEOUT)
  try {
    // net.fetch 走 Electron 网络栈（遵循代理/证书设置），比全局 fetch 更合适
    return await net.fetch(url, { headers, signal: abort.signal })
  } catch (e) {
    if (timedOut && !rendererSignal.aborted) throw new HeaderTimeoutError()
    throw e
  } finally {
    clearTimeout(timer)
  }
}

function parseRangeStart(range: string | null): number {
  if (!range) return 0
  const m = /bytes=(\d+)-/.exec(range)
  return m ? parseInt(m[1], 10) : 0
}

/** 用 Web TransformStream 边下边解密（按文件偏移喂流密码，天然支持 Range） */
function decryptStream(
  src: ReadableStream<Uint8Array>,
  decryptor: AudioDecryptor,
  startOffset: number
): ReadableStream<Uint8Array> {
  let offset = startOffset
  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      const buf = Buffer.from(chunk)
      controller.enqueue(decryptor.decrypt(buf, offset))
      offset += buf.length
    }
  })
  return src.pipeThrough(transform)
}

/** 丢弃流的前 n 字节（上游无视 Range 回全量 200 时，用来手工剥伪造头） */
function dropBytesStream(src: ReadableStream<Uint8Array>, n: number): ReadableStream<Uint8Array> {
  let remaining = n
  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      if (remaining > 0) {
        if (chunk.length <= remaining) {
          remaining -= chunk.length
          return
        }
        chunk = chunk.subarray(remaining)
        remaining = 0
      }
      controller.enqueue(chunk)
    }
  })
  return src.pipeThrough(transform)
}

/** 必须在 app ready 前调用：把 scheme 注册为特权（支持流 + fetch + 视为安全上下文）。 */
export function registerAudioScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: {
        standard: true,
        secure: true,
        stream: true,
        supportFetchAPI: true,
        corsEnabled: true
      }
    }
  ])
}

/** app ready 后调用：挂上协议处理器（kunyin://stream/* 音频流）。 */
export function installAudioProtocol(): void {
  protocol.handle(SCHEME, async (request) => {
    const parsed = new URL(request.url)
    const token = parsed.pathname.replace(/^\/+/, '')
    const spec = registry.get(token)
    if (!spec) {
      // 正在播的流被挤出 registry 时，<audio> 的下一次 Range 请求就会撞到这里，
      // 播放随即中断且没有任何提示——所以命中要刷新 LRU 位置（见下方 touch）。
      console.warn('[audio] 未知或已失效的流 token', token)
      return new Response(null, { status: 404 })
    }
    // 命中即提到最新，避免「正在播放但注册得早」的流被后续注册淘汰
    registry.delete(token)
    registry.set(token, spec)

    const range = request.headers.get('Range')

    // 本地文件：直接 fs 流式响应，不走网络栈
    if (spec.filePath) return serveLocalFile(spec.filePath, range)
    if (!spec.url) return new Response(null, { status: 404 })

    const headers: Record<string, string> = { 'User-Agent': 'Mozilla/5.0', ...(spec.headers ?? {}) }
    // 加密流可能带伪造头（Spotify 0xa7，见 crypto/aesctr.ts）：上游 Range 与解密偏移整体
    // 平移 skip 字节，呈现给渲染层的始终是剥头后的真实音频坐标
    const skip = spec.ekey ? cipherHeaderSize(spec.cipher) : 0
    let upstreamStart = 0
    if (skip > 0) {
      const m = range ? /bytes=(\d+)-(\d*)/.exec(range) : null
      upstreamStart = (m ? parseInt(m[1], 10) : 0) + skip
      const end = m && m[2] ? String(parseInt(m[2], 10) + skip) : ''
      headers['Range'] = `bytes=${upstreamStart}-${end}`
    } else if (range) {
      upstreamStart = parseRangeStart(range)
      headers['Range'] = range
    }

    let upstream: Response
    try {
      upstream = await fetchUpstreamOnce(spec.url, headers, request.signal)
    } catch (e) {
      // 取消属正常流程（seek/换歌），不当错误报
      if (request.signal.aborted || (e as Error)?.name === 'AbortError') {
        return new Response(null, { status: 499 })
      }
      if (!isRetryable(e)) {
        // 别静默吞掉：代理不可达/DNS/证书失败在这里全都长得像一个光秃秃的 502
        console.error('[audio] 上游取流失败', spec.url, e)
        return new Response(null, { status: 502 })
      }
      // 网络切换/半死连接：清掉连接池（等价重启对网络栈的效果）后原地重试一次。
      // 以前这里直接报 504/502，用户只能靠重启调试自救。
      console.warn('[audio] 网络抖动，清连接池后重试', (e as Error)?.message ?? e)
      try {
        await flushConnectionPool()
        await sleep(NET_RETRY_DELAY)
        upstream = await fetchUpstreamOnce(spec.url, headers, request.signal)
      } catch (e2) {
        if (request.signal.aborted || (e2 as Error)?.name === 'AbortError') {
          return new Response(null, { status: 499 })
        }
        if (e2 instanceof HeaderTimeoutError) {
          console.error('[audio] 上游响应超时（重试后仍超时）', spec.url)
          return new Response(null, { status: 504 })
        }
        console.error('[audio] 上游取流失败（重试后仍失败）', spec.url, e2)
        return new Response(null, { status: 502 })
      }
    }
    if (upstream.status >= 400 || !upstream.body) {
      return new Response(null, { status: upstream.status >= 400 ? upstream.status : 502 })
    }

    const out = new Headers()
    out.set('Accept-Ranges', 'bytes')
    out.set(
      'Content-Type',
      spec.contentType ?? upstream.headers.get('content-type') ?? 'audio/mpeg'
    )
    const cl = upstream.headers.get('content-length')
    const cr = upstream.headers.get('content-range')
    let status = upstream.status
    if (skip > 0) {
      // 坐标平移回「剥头后」：206 的区间与总量都减 skip；200（Range 被无视）减手工剥掉的字节
      if (cl) {
        const n = Number(cl) - (upstream.status === 200 ? upstreamStart : 0)
        if (n > 0) out.set('Content-Length', String(n))
      }
      if (upstream.status === 206 && cr) {
        const m = /bytes (\d+)-(\d+)\/(\d+|\*)/.exec(cr)
        if (m) {
          const total = m[3] === '*' ? '*' : String(Number(m[3]) - skip)
          out.set('Content-Range', `bytes ${Number(m[1]) - skip}-${Number(m[2]) - skip}/${total}`)
        }
        if (!range) {
          // 渲染层没发 Range（要整文件）：我们的剥头 Range 是内部细节，对外回落为 200
          out.delete('Content-Range')
          status = 200
        }
      }
    } else {
      if (cl) out.set('Content-Length', cl)
      if (cr) out.set('Content-Range', cr)
    }

    const decryptor = spec.ekey ? createAudioDecryptor(spec.cipher, spec.ekey) : null
    if (spec.ekey && !decryptor) {
      console.warn('[audio] ekey 流暂无解密器，透传（播放将异常）')
    }
    let body: ReadableStream<Uint8Array> = upstream.body
    // 上游无视 Range 回了全量 200：手工剥掉 upstreamStart 之前的密文（解密偏移相应对齐）
    if (skip > 0 && upstream.status === 200 && upstreamStart > 0) {
      body = dropBytesStream(body, upstreamStart)
    }
    if (decryptor) body = decryptStream(body, decryptor, upstreamStart)

    return new Response(body as BodyInit, { status, headers: out })
  })
}

/**
 * 注册一路音频流，返回可直接喂 <audio> 的 kunyin:// URL。
 * 超出上限时淘汰最久未被请求的一路（Map 迭代序即 LRU 序，handler 命中时会 touch）。
 */
export function registerAudioStream(spec: AudioStreamSpec): string {
  while (registry.size >= MAX_ENTRIES) {
    const oldest = registry.keys().next().value
    if (oldest === undefined) break
    registry.delete(oldest)
  }
  const token = randomBytes(8).toString('hex')
  registry.set(token, spec)
  return `${SCHEME}://stream/${token}`
}
