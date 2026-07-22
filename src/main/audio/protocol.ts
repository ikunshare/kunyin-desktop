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
import { protocol, net } from 'electron'
import { randomBytes } from 'node:crypto'
import { createMflacDecryptor, type AudioDecryptor } from '../crypto/mflac'

export interface AudioStreamSpec {
  url: string
  /** 上游请求头（Referer/UA/Cookie 等） */
  headers?: Record<string, string>
  /** QQ 加密流的 ekey，非空时边下边解密 */
  ekey?: string
  contentType?: string
}

const SCHEME = 'kunyin'
const MAX_ENTRIES = 64
const registry = new Map<string, AudioStreamSpec>()

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

/** 必须在 app ready 前调用：把 scheme 注册为特权（支持流 + fetch + 视为安全上下文）。 */
export function registerAudioScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true }
    }
  ])
}

/** app ready 后调用：挂上协议处理器。 */
export function installAudioProtocol(): void {
  protocol.handle(SCHEME, async (request) => {
    const token = new URL(request.url).pathname.replace(/^\/+/, '')
    const spec = registry.get(token)
    if (!spec) return new Response(null, { status: 404 })

    const range = request.headers.get('Range')
    const headers: Record<string, string> = { 'User-Agent': 'Mozilla/5.0', ...(spec.headers ?? {}) }
    if (range) headers['Range'] = range

    let upstream: Response
    try {
      // net.fetch 走 Electron 网络栈（遵循代理/证书设置），比全局 fetch 更合适
      upstream = await net.fetch(spec.url, { headers })
    } catch {
      return new Response(null, { status: 502 })
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
    if (cl) out.set('Content-Length', cl)
    const cr = upstream.headers.get('content-range')
    if (cr) out.set('Content-Range', cr)

    const decryptor = spec.ekey ? createMflacDecryptor(spec.ekey) : null
    if (spec.ekey && !decryptor) {
      console.warn('[audio] ekey 流暂无解密器，透传（播放将异常）')
    }
    const body = decryptor
      ? decryptStream(upstream.body, decryptor, parseRangeStart(range))
      : upstream.body

    return new Response(body as BodyInit, { status: upstream.status, headers: out })
  })
}

/** 注册一路音频流，返回可直接喂 <audio> 的 kunyin:// URL。 */
export function registerAudioStream(spec: AudioStreamSpec): string {
  if (registry.size >= MAX_ENTRIES) {
    const oldest = registry.keys().next().value
    if (oldest) registry.delete(oldest)
  }
  const token = randomBytes(8).toString('hex')
  registry.set(token, spec)
  return `${SCHEME}://stream/${token}`
}
