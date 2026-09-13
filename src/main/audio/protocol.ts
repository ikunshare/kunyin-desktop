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
import { createAudioDecryptor, type AudioDecryptor } from '../crypto/decryptor'
import {
  blockPath,
  blockRange,
  ensureAudioCacheRecord,
  getAudioCacheRecord,
  openBlockWriter,
  planRange,
  verifyBlock,
  type CacheRecord
} from '../cache/audioCache'
import { createLogger } from '../core/logger'

const log = createLogger('audio')

/** 日志用：只取主机名。直链的 query 带 vkey/guid，一概不进日志。 */
function hostOf(raw: string): string {
  try {
    return new URL(raw).hostname
  } catch {
    return '非法地址'
  }
}

export interface AudioStreamSpec {
  /** 远程直链；与 filePath 二选一。完整命中音频缓存时可以不给（全程走本地块）。 */
  url?: string
  /** 本地音频文件绝对路径（「添加本地歌曲」），直接 fs 流式读取 */
  filePath?: string
  /** 上游请求头（Referer/UA/Cookie 等） */
  headers?: Record<string, string>
  /** 加密流的 ekey，非空时边下边解密（QQ mflac/mgg QMC2） */
  ekey?: string
  contentType?: string
  /**
   * 音频分块缓存键 platform_id_quality（见 cache/audioCache）。给了它就走缓存感知路径：
   * 本地已有的块直接读文件，缺的块回源并顺手落盘，下次播放就少下一块。
   */
  cacheKey?: string
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

/**
 * 本地文件响应：fs.createReadStream + 手工 206 Range（seek 全靠它）
 * @param contentType 显式指定的 MIME（音频缓存命中时用索引里记的那个）；
 *   不给则按扩展名推断——缓存文件的扩展名由 Content-Type 反推而来，未知格式会落成 .bin。
 */
function serveLocalFile(filePath: string, range: string | null, contentType?: string): Response {
  let size: number
  try {
    size = statSync(filePath).size
  } catch (error) {
    log.warn('本地音频读取失败', error)
    return new Response(null, { status: 404 })
  }
  const mime =
    contentType ?? LOCAL_MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
  let start = 0
  let end = size - 1
  let status = 200
  const headers = new Headers({
    'Access-Control-Allow-Origin': '*',
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
 *
 * 取值要短：后面还要换主机重试，20s 一档会让首次播放最坏等上一分钟。
 */
const UPSTREAM_HEADER_TIMEOUT = 12_000

/** 一路取流最多试几个地址（原地址 + 换路候选） */
const MAX_UPSTREAM_ATTEMPTS = 3

/**
 * 上游请求 UA：对齐真实浏览器。部分 CDN/WAF 会把裸 `Mozilla/5.0` 当机器人，
 * 表现为连接后长期不给响应头（upstream header timeout），浏览器带完整 UA 则秒回。
 */
const UPSTREAM_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

/**
 * 快速失败且值得重试的网络错误：多见于 VPN/代理切换节点、Wi-Fi 切换的瞬间，
 * Chromium 会把在飞请求判死（ERR_NETWORK_CHANGED），等网络落定后重发一般就通。
 *
 * 也收了「地址不可达/连接超时」一类：IPv6 半通或 CDN 坏节点就长这样，
 * 现在重试会换到同族的其它主机（见 upstreamAttempts），换路后往往立刻恢复。
 */
const RETRYABLE_NET_ERRORS = [
  'ERR_NETWORK_CHANGED',
  'ERR_CONNECTION_RESET',
  'ERR_CONNECTION_CLOSED',
  'ERR_CONNECTION_TIMED_OUT',
  'ERR_CONNECTION_FAILED',
  'ERR_ADDRESS_UNREACHABLE',
  'ERR_EMPTY_RESPONSE',
  'ERR_TIMED_OUT'
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

function isRetryable(e: unknown): boolean {
  if (e instanceof HeaderTimeoutError) return true
  const msg = e instanceof Error ? e.message : String(e)
  return RETRYABLE_NET_ERRORS.some((code) => msg.includes(code))
}

/**
 * QQ 下发的加密音频地址仍常是 http://music.tc.qq.com。
 * 该域名的 HTTP 路由可能优先命中不可用的 IPv6 CDN 节点，表现为连接建立后长期收不到响应头；
 * 同一资源走 HTTPS 会重新选路且 QQ CDN 原生支持 Range，因此在进入解密代理前统一升级。
 */
function normalizeUpstreamUrl(raw: string): string {
  try {
    const url = new URL(raw)
    if (url.protocol === 'http:' && /(^|\.)music\.tc\.qq\.com$/i.test(url.hostname)) {
      url.protocol = 'https:'
      return url.toString()
    }
  } catch {
    // 非法 URL 交给 net.fetch 按原错误处理
  }
  return raw
}

/** http → https 升级（用于等响应头超时后的换路重试）；非 http 或非法 URL 返回 null。 */
function httpsUpgrade(raw: string): string | null {
  try {
    const url = new URL(raw)
    if (url.protocol !== 'http:') return null
    url.protocol = 'https:'
    return url.toString()
  } catch {
    return null
  }
}

/**
 * QQ 音乐 CDN 的同族主机：vkey 与主机无关，同一条 path+query 换台主机照样能取，
 * 而各主机解析到不同 IP 段。某个节点把连接挂住却不给响应头时（IPv6 半通、坏节点），
 * 换主机是唯一能自救的手段——原地重试同一个 https 地址必然还是同样结果。
 */
const QQ_CDN_TARGETS = [
  'ws.stream.qqmusic.qq.com',
  'ws6.stream.qqmusic.qq.com',
  'isure.stream.qqmusic.qq.com',
  'dl.stream.qqmusic.qq.com',
  'aqqmusic.tc.qq.com'
]
/** 可识别为 QQ 取流地址的主机（music.tc.qq.com 只作来源、不作换路目标：它本身就常年不通） */
const QQ_CDN_ORIGINS = new Set([...QQ_CDN_TARGETS, 'music.tc.qq.com'])

/**
 * 一路取流按顺序要试的地址：原地址 → https 升级 → 同族其它 CDN 主机。
 * 去重后截断到 MAX_UPSTREAM_ATTEMPTS，避免一首歌卡在重试里出不来。
 *
 * 没有换路候选时（非 QQ 音源）补一次原地址重试——网络切换那类抖动重发同一地址就能通。
 */
function upstreamAttempts(raw: string): string[] {
  const out = [raw]
  const push = (u: string): void => {
    if (!out.includes(u)) out.push(u)
  }
  const https = httpsUpgrade(raw)
  if (https) push(https)
  try {
    const url = new URL(raw)
    const host = url.hostname.toLowerCase()
    if (QQ_CDN_ORIGINS.has(host)) {
      for (const target of QQ_CDN_TARGETS) {
        if (target === host) continue
        const alt = new URL(raw)
        alt.protocol = 'https:'
        alt.hostname = target
        push(alt.toString())
      }
    }
  } catch {
    // 非法 URL：只用原地址，由 net.fetch 报原错误
  }
  if (out.length === 1) out.push(raw)
  return out.slice(0, MAX_UPSTREAM_ATTEMPTS)
}

/**
 * 当前在飞的上游取流数。只用于诊断：Chromium 每主机只给 6 个并发额度，
 * 一旦出现「连上了却等不到响应头」，这个数字能直接分辨是我们漏了连接（数值一路涨）
 * 还是纯粹上游/线路不通（数值仍是 1、2）。
 */
let inFlightUpstreams = 0

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
  inFlightUpstreams++
  try {
    // net.fetch 走 Electron 网络栈（遵循代理/证书设置），比全局 fetch 更合适
    return await net.fetch(url, { headers, signal: abort.signal })
  } catch (e) {
    if (timedOut && !rendererSignal.aborted) throw new HeaderTimeoutError()
    throw e
  } finally {
    inFlightUpstreams--
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

/**
 * 这一路上游能提供的**完整文件**字节数；拿不准一律返回 0（那就不缓存）。
 * - 200 + Content-Length：整文件
 * - 206 + `Content-Range: bytes 0-N/TOTAL`：TOTAL 即完整长度
 */
function parseTotalSize(
  status: number,
  contentLength: string | null,
  contentRange: string | null
): number {
  if (contentRange) {
    const m = /bytes\s+\d+-\d+\/(\d+)/i.exec(contentRange)
    if (!m) return 0
    const total = parseInt(m[1], 10)
    return Number.isFinite(total) && total > 0 ? total : 0
  }
  if (status === 200 && contentLength) {
    const size = parseInt(contentLength, 10)
    return Number.isFinite(size) && size > 0 ? size : 0
  }
  return 0
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

/**
 * 取一路上游流（含「等响应头超时 → 换路重试」）。
 * @returns 成功给 Response（body 必非空）；失败给一个可直接返回给 <audio> 的错误 Response
 */
async function fetchUpstream(
  url: string,
  headers: Record<string, string>,
  signal: AbortSignal
): Promise<{ ok: true; upstream: Response } | { ok: false; error: Response }> {
  const attempts = upstreamAttempts(url)
  const aborted = (): { ok: false; error: Response } => ({
    ok: false,
    error: new Response(null, { status: 499 })
  })

  for (let i = 0; i < attempts.length; i++) {
    const target = attempts[i]
    // 仅重试当前请求。不能 closeAllConnections()：它会把正在播放或刚切换的其他歌曲
    // 一并中止，制造与真实网络故障无关的 net::ERR_ABORTED。
    if (i > 0) {
      await sleep(NET_RETRY_DELAY)
      if (signal.aborted) return aborted()
    }
    try {
      const upstream = await fetchUpstreamOnce(target, headers, signal)
      if (upstream.status >= 400 || !upstream.body) {
        log.warn('上游拒绝取流', { status: upstream.status, host: hostOf(target) })
        // 必须主动 cancel：不消费也不取消的响应体会把那条上游连接一直挂在池子里，
        // 403（直链过期）在播放中途是常态，攒下来的孤儿连接会占满 per-host 连接数，
        // 之后的取流请求只能排队——表现为切歌越来越慢。
        void upstream.body?.cancel().catch(() => {})
        // 4xx/5xx 是上游给出的明确答复（直链过期、鉴权不通），换主机也是同样结果，不再试
        return {
          ok: false,
          error: new Response(null, { status: upstream.status >= 400 ? upstream.status : 502 })
        }
      }
      if (i > 0) log.info('换路取流成功', { host: hostOf(target) })
      return { ok: true, upstream }
    } catch (e) {
      // 取消属正常流程（seek/换歌），不当错误报
      if (signal.aborted || (e as Error)?.name === 'AbortError') return aborted()
      if (!isRetryable(e)) {
        // 别静默吞掉：代理不可达/DNS/证书失败在这里全都长得像一个光秃秃的 502
        log.error('上游取流失败', e, { host: hostOf(target) })
        return { ok: false, error: new Response(null, { status: 502 }) }
      }
      if (e instanceof HeaderTimeoutError) {
        // 「重启才恢复」的典型根因是主机解析器缓存了坏 IP/坏路由：清掉后重试才能重新解析，
        // 而不是继续连同一个坏地址。仅清 DNS 缓存，不影响正在播放的其它歌曲。
        await session.defaultSession.clearHostResolverCache().catch(() => {})
      }
      const last = i === attempts.length - 1
      const msg = (e as Error)?.message ?? String(e)
      if (last) {
        log.error('上游取流失败（全部候选）', msg, { hosts: attempts.map(hostOf) })
        return {
          ok: false,
          error: new Response(null, { status: e instanceof HeaderTimeoutError ? 504 : 502 })
        }
      }
      log.warn('上游取流失败，换路重试', { error: msg, inFlight: inFlightUpstreams, host: hostOf(attempts[i + 1]) })
    }
  }
  // 循环必然在内部返回，这里只为类型完备
  return { ok: false, error: new Response(null, { status: 502 }) }
}

/**
 * 把响应体的生命周期绑到渲染层这条请求上。
 *
 * `protocol.handle` 返回的 Response 有可能压根不会被消费——最典型的是 await 上游期间
 * <audio> 已经 seek/切歌，Electron 直接把这条响应丢掉。此时上游那条连接既没被读、也没被
 * cancel，会一直挂在 Chromium 的连接池里；每个主机只有 6 个并发额度，攒够了之后新的取流
 * 只能排队等额度——表现正是「放久了之后每首歌都 upstream header timeout」，且跨主机同时中招。
 * 绑上 signal 后，请求一取消就 cancel 上游流，连接立刻归还。
 */
function bindToRequest(
  src: ReadableStream<Uint8Array>,
  signal: AbortSignal
): ReadableStream<Uint8Array> {
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>()
  void src.pipeTo(writable, { signal }).catch(() => {
    // 取消/断流属正常路径（seek、切歌、网络中断）；错误已经由 readable 侧传给 <audio>
  })
  return readable
}

/** 上游请求头（带上调用方指定的 Range） */
function upstreamHeaders(spec: AudioStreamSpec, range?: string): Record<string, string> {
  const headers: Record<string, string> = { 'User-Agent': UPSTREAM_UA, ...(spec.headers ?? {}) }
  if (range) headers['Range'] = range
  return headers
}

/** 解密后的上游流（按绝对偏移喂流密码，Range 请求同样正确） */
function decryptedBody(
  spec: AudioStreamSpec,
  upstream: Response,
  startOffset: number
): ReadableStream<Uint8Array> {
  const decryptor = spec.ekey ? createAudioDecryptor(spec.ekey) : null
  if (spec.ekey && !decryptor) {
    log.warn('加密流暂无解密器，透传（播放将异常）')
  }
  const body = upstream.body as ReadableStream<Uint8Array>
  return decryptor ? decryptStream(body, decryptor, startOffset) : body
}

/** 把 async generator 接成 ReadableStream；cancel 时走 generator 的 finally（收尾落块） */
function streamFrom(gen: AsyncGenerator<Uint8Array>): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await gen.next()
        if (done) {
          controller.close()
          return
        }
        controller.enqueue(value)
      } catch (e) {
        controller.error(e)
      }
    },
    async cancel() {
      await gen.return(undefined).catch(() => {})
    }
  })
}

/** 从本地块读出 [emitStart, emitEnd]（闭区间，必须都在已验证的块内） */
async function* readLocalBlocks(
  key: string,
  record: CacheRecord,
  emitStart: number,
  emitEnd: number
): AsyncGenerator<Uint8Array> {
  const first = Math.floor(emitStart / record.blockSize)
  const last = Math.floor(emitEnd / record.blockSize)
  for (let i = first; i <= last; i++) {
    const { start, end } = blockRange(record, i)
    const from = Math.max(start, emitStart) - start
    const to = Math.min(end, emitEnd) - start
    if (from > to) continue
    const stream = createReadStream(blockPath(key, i), { start: from, end: to })
    for await (const chunk of stream) yield chunk as Uint8Array
  }
}

/**
 * 回源 [fetchStart, fetchEnd]（按块边界对齐，方便整块落盘），
 * 但只把 [emitStart, emitEnd] 这一段吐给 <audio>。
 *
 * 断流/切歌时 finally 里 writer.finish() 只保留已下满的块——分块缓存的意义就在这里：
 * 听了一半的歌下次能接着补，而不是从头再来。
 */
async function* fetchAndStore(
  spec: AudioStreamSpec,
  key: string,
  record: CacheRecord,
  fetchStart: number,
  fetchEnd: number,
  emitStart: number,
  emitEnd: number,
  signal: AbortSignal
): AsyncGenerator<Uint8Array> {
  if (!spec.url) throw new Error('缺块需要回源，但这一路没有直链')
  const result = await fetchUpstream(
    spec.url,
    upstreamHeaders(spec, `bytes=${fetchStart}-${fetchEnd}`),
    signal
  )
  if (!result.ok) throw new Error(`上游取流失败 ${result.error.status}`)
  const body = decryptedBody(spec, result.upstream, fetchStart)
  const writer = openBlockWriter(key, record, fetchStart)
  const reader = body.getReader()
  let pos = fetchStart
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done || !value) break
      writer.write(value)
      const chunkStart = pos
      const chunkEnd = pos + value.byteLength - 1
      pos = chunkEnd + 1
      const s = Math.max(chunkStart, emitStart)
      const e = Math.min(chunkEnd, emitEnd)
      if (s <= e) yield value.subarray(s - chunkStart, e - chunkStart + 1)
      // 读满整个回源区间就停（emitEnd 之后那点是为凑整块多下的，仍要喂给 writer）
      if (pos > fetchEnd) break
    }
  } finally {
    writer.finish()
    void reader.cancel().catch(() => {})
  }
}

/**
 * 按块拼出 [start, end]：本地有的块直接读文件，缺的块按块边界对齐回源并顺手补齐。
 * 分段计划由 planRange 算（纯函数，保证各段 emit 区间恰好覆盖 [start, end]）。
 */
async function* assembleRange(
  spec: AudioStreamSpec,
  key: string,
  record: CacheRecord,
  start: number,
  end: number,
  signal: AbortSignal
): AsyncGenerator<Uint8Array> {
  // 先把涉及的块逐个验一遍（大小对不上的会被剔出索引，当作缺块回源补齐）
  const available = new Set<number>()
  const first = Math.floor(start / record.blockSize)
  const last = Math.floor(end / record.blockSize)
  for (let i = first; i <= last; i++) {
    if (await verifyBlock(key, record, i)) available.add(i)
  }
  for (const seg of planRange(record, (i) => available.has(i), start, end)) {
    if (seg.local) {
      yield* readLocalBlocks(key, record, seg.emitStart, seg.emitEnd)
    } else {
      yield* fetchAndStore(
        spec,
        key,
        record,
        seg.fetchStart,
        seg.fetchEnd,
        seg.emitStart,
        seg.emitEnd,
        signal
      )
    }
  }
}

/** 解析 Range 头到闭区间；越界返回 null（调用方回 416） */
function resolveRange(
  range: string | null,
  size: number
): { start: number; end: number; partial: boolean } | null {
  if (!range) return { start: 0, end: size - 1, partial: false }
  const m = /bytes=(\d*)-(\d*)/.exec(range)
  if (!m) return { start: 0, end: size - 1, partial: false }
  if (!m[1]) {
    // `bytes=-N`：最后 N 字节
    const n = parseInt(m[2], 10)
    if (!Number.isFinite(n) || n <= 0) return null
    return { start: Math.max(0, size - n), end: size - 1, partial: true }
  }
  const start = parseInt(m[1], 10)
  if (!Number.isFinite(start) || start >= size) return null
  const end = m[2] ? Math.min(parseInt(m[2], 10), size - 1) : size - 1
  if (end < start) return null
  return { start, end, partial: true }
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
      log.warn('未知或已失效的音频流')
      return new Response(null, { status: 404 })
    }
    // 命中即提到最新，避免「正在播放但注册得早」的流被后续注册淘汰
    registry.delete(token)
    registry.set(token, spec)

    const range = request.headers.get('Range')

    // 本地文件：直接 fs 流式响应，不走网络栈
    if (spec.filePath) return serveLocalFile(spec.filePath, range, spec.contentType)

    // 已有缓存条目（知道总长与已有块）：按块拼接，本地块直读、缺块回源补齐
    const key = spec.cacheKey
    const record = key ? getAudioCacheRecord(key) : null
    if (key && record) {
      const resolved = resolveRange(range, record.size)
      if (!resolved) {
        return new Response(null, {
          status: 416,
          headers: { 'Content-Range': `bytes */${record.size}` }
        })
      }
      const { start, end, partial } = resolved
      const out = new Headers({
        'Access-Control-Allow-Origin': '*',
        'Accept-Ranges': 'bytes',
        'Content-Type': record.contentType,
        'Content-Length': String(end - start + 1)
      })
      if (partial) out.set('Content-Range', `bytes ${start}-${end}/${record.size}`)
      const body = streamFrom(assembleRange(spec, key, record, start, end, request.signal))
      return new Response(bindToRequest(body, request.signal) as BodyInit, {
        status: partial ? 206 : 200,
        headers: out
      })
    }

    if (!spec.url) return new Response(null, { status: 404 })

    // 还没有条目（首次播放）：直连上游，顺便按响应头建条目并边下边落块
    const upstreamStart = range ? parseRangeStart(range) : 0
    const result = await fetchUpstream(
      spec.url,
      upstreamHeaders(spec, range ?? undefined),
      request.signal
    )
    if (!result.ok) return result.error
    const upstream = result.upstream

    // 等上游响应头这段时间里 <audio> 可能已经 seek/切歌。此时 Electron 会把返回的
    // Response 直接丢掉，谁也不会去 cancel 它——必须自己收掉，否则这条连接会一直占着
    // per-host 的并发额度（见 bindToRequest）。
    if (request.signal.aborted) {
      void upstream.body?.cancel().catch(() => {})
      return new Response(null, { status: 499 })
    }

    const contentType = spec.contentType ?? upstream.headers.get('content-type') ?? 'audio/mpeg'
    const out = new Headers()
    out.set('Access-Control-Allow-Origin', '*')
    out.set('Accept-Ranges', 'bytes')
    out.set('Content-Type', contentType)
    const cl = upstream.headers.get('content-length')
    const cr = upstream.headers.get('content-range')
    const status = upstream.status
    if (cl) out.set('Content-Length', cl)
    if (cr) out.set('Content-Range', cr)

    let body = decryptedBody(spec, upstream, upstreamStart)

    // 挂在解密之后：缓存里存的是可直接播的明文。总长度从响应头得出，
    // 拿不到就不缓存（宁可不存，也不写出长度存疑的块）。
    if (key) {
      const total = parseTotalSize(status, cl, cr)
      const fresh = total > 0 ? ensureAudioCacheRecord(key, total, contentType) : null
      if (fresh) body = tapToBlocks(body, key, fresh, upstreamStart)
    }

    return new Response(bindToRequest(body, request.signal) as BodyInit, { status, headers: out })
  })
}

/**
 * 把流原样透传给 <audio>，同时按块落盘。
 *
 * 用 pull 驱动的包装而不是 tee()：tee 的两路共享背压，慢的一路会让内部缓冲无限膨胀。
 * 这里读一块、写一块、发一块，背压天然跟着 <audio> 的消费速度；cancel（切歌）时
 * writer.finish() 保留已下满的块，正在攒的那块丢掉。
 */
function tapToBlocks(
  src: ReadableStream<Uint8Array>,
  key: string,
  record: CacheRecord,
  startOffset: number
): ReadableStream<Uint8Array> {
  const reader = src.getReader()
  const writer = openBlockWriter(key, record, startOffset)
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read()
        if (done || !value) {
          writer.finish()
          controller.close()
          return
        }
        writer.write(value)
        controller.enqueue(value)
      } catch (e) {
        writer.finish()
        controller.error(e)
      }
    },
    cancel(reason) {
      writer.finish()
      return reader.cancel(reason)
    }
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
  registry.set(token, spec.url ? { ...spec, url: normalizeUpstreamUrl(spec.url) } : spec)
  return `${SCHEME}://stream/${token}`
}
