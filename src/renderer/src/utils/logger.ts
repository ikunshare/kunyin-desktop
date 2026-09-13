/**
 * 渲染层日志。
 *
 * 与主进程 `src/main/core/logger.ts` 同形（scope / 级别 / detail），但多做一件事：
 * 每条都转发给主进程统一落盘。播放失败这类问题的因果链横跨两个进程
 * （渲染层 <audio> 报错 ← 主进程取流 302 ← 后端 getUrl 拒绝），只有写进同一份
 * 带时间戳的文件里才看得出先后。
 *
 * 打开方式：Ctrl+F12 开 DevTools 看实时控制台，或设置 → 开发者 → 打开日志目录看历史。
 */
import { LOG_LEVEL_WEIGHT, type LogEntry, type LogLevel, type LogSide } from '@common'

type WritableLevel = Exclude<LogLevel, 'silent'>

/** 控制台前缀配色，让 warn/error 在刷屏的日志里一眼可见 */
const STYLE: Record<WritableLevel, string> = {
  debug: 'color:#8b95a1',
  info: 'color:#4daf7c;font-weight:600',
  warn: 'color:#e6a23c;font-weight:600',
  error: 'color:#e5484d;font-weight:700'
}

let currentLevel: LogLevel = 'info'
let side: LogSide = 'renderer'

/** 由 settings store 在设置载入/变更时调用。 */
export function setRendererLogLevel(level: LogLevel): void {
  currentLevel = level
}

/** 桌面歌词窗口入口调用一次，日志里就能区分是哪个窗口发出的。 */
export function setLogSide(value: LogSide): void {
  side = value
}

function shouldLog(level: WritableLevel): boolean {
  return LOG_LEVEL_WEIGHT[level] >= LOG_LEVEL_WEIGHT[currentLevel]
}

import { redact as plain, sanitizeText } from '@common/logSanitize'

function serialize(detail: unknown): string | undefined {
  if (detail === undefined) return undefined
  try {
    const s = JSON.stringify(plain(detail))
    return s === undefined ? undefined : s.length > 4000 ? `${s.slice(0, 4000)}…截断` : s
  } catch {
    return '"[detail 序列化失败]"'
  }
}

let emitting = false
let second = 0
let sent = 0
function emit(scope: string, level: WritableLevel, message: string, detail?: unknown): void {
  if (!shouldLog(level)) return

  if (emitting) return
  emitting = true
  try {
    message = sanitizeText(message)
    scope = sanitizeText(scope, 40)
    const safeDetail = serialize(detail)
    try {
      const sink = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
      sink(`%c[${scope}]%c ${message}`, STYLE[level], '', safeDetail ?? '')
    } catch {
      /* Console can be unavailable. Still attempt IPC. */
    }

    const entry: LogEntry = {
      time: Date.now(),
      level,
      side,
      scope,
      message,
      detail: safeDetail
    }
    try {
      const now = Math.floor(Date.now() / 1000)
      if (now !== second) {
        second = now
        sent = 0
      }
      if (++sent <= 100) window.api?.log?.write(entry)
    } catch {
      /* preload 未就绪或桥接失败：控制台已经打过了，不再纠缠 */
    }
  } catch {
    /* Never throw from diagnostics. */
  } finally {
    emitting = false
  }
}

export interface RendererLogger {
  debug(message: string, detail?: unknown): void
  info(message: string, detail?: unknown): void
  warn(message: string, detail?: unknown): void
  error(message: string, error?: unknown, detail?: Record<string, unknown>): void
  /** 计时：返回结束函数，调用时按 debug 记录耗时（ms） */
  time(message: string, detail?: unknown): (extra?: Record<string, unknown>) => void
  child(sub: string): RendererLogger
  readonly verbose: boolean
}

export function createLogger(scope: string): RendererLogger {
  return {
    debug: (m, d) => emit(scope, 'debug', m, d),
    info: (m, d) => emit(scope, 'info', m, d),
    warn: (m, d) => emit(scope, 'warn', m, d),
    error: (m, err, d) =>
      emit(
        scope,
        'error',
        m,
        err === undefined && d === undefined ? undefined : { detail: d, err }
      ),
    time: (m, d) => {
      const start = performance.now()
      return (extra) =>
        emit(scope, 'debug', m, {
          detail: d,
          extra,
          costMs: Math.round(performance.now() - start)
        })
    },
    child: (sub) => createLogger(`${scope}:${sub}`),
    get verbose() {
      return shouldLog('debug')
    }
  }
}

export const log = createLogger('app')

/**
 * 全局兜底：没有这层，渲染层的脚本错误只会留在没人打开的控制台里，
 * Release 下表现为「点了没反应」。入口（App / 桌面歌词）各调用一次。
 */
export function installGlobalErrorHandlers(): void {
  window.addEventListener(
    'error',
    (e) => {
      // 资源加载失败（img/audio/script）的 target 不是 window，单独记，便于区分封面挂了还是脚本挂了
      const target = e.target as (HTMLElement & { src?: string; currentSrc?: string }) | null
      if (target && target !== (window as unknown as HTMLElement) && target.tagName) {
        log.warn('资源加载失败', {
          tag: target.tagName,
          src: target.currentSrc || target.src || ''
        })
        return
      }
      log.error('未捕获脚本错误', e.error ?? e.message, {
        source: e.filename,
        line: e.lineno,
        column: e.colno
      })
    },
    true
  )

  window.addEventListener('unhandledrejection', (e) => {
    log.error('未处理的 Promise 拒绝', e.reason)
  })
}
