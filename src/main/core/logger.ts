/** Bounded best-effort diagnostics. Review logs before sharing; redaction is not a security guarantee. */
import { app } from 'electron'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import {
  DEFAULT_SETTINGS,
  LOG_LEVEL_WEIGHT,
  type LogEntry,
  type LogFileInfo,
  type LogLevel,
  type LogSide
} from '@common'
import { appDataPath } from './paths'

/** 单个日志文件上限，超过后同日再开一片 */
const MAX_FILE_BYTES = 8 * 1024 * 1024
/** 日志目录总量上限，超过按时间从旧到新删 */
const MAX_DIR_BYTES = 64 * 1024 * 1024
/** 保留天数 */
const RETAIN_DAYS = 7
/** 内存环形缓冲容量（设置页「查看最近日志」与导出用） */
const RING_SIZE = 600
/** 非紧急日志的落盘节流间隔 */
const FLUSH_INTERVAL = 400
/** 单条 detail 序列化后的长度上限，防止一条超长响应体撑爆日志 */
const MAX_DETAIL_CHARS = 4000

type WritableLevel = Exclude<LogLevel, 'silent'>

const LEVEL_TAG: Record<WritableLevel, string> = {
  debug: 'DEBUG',
  info: 'INFO ',
  warn: 'WARN ',
  error: 'ERROR'
}

let currentLevel: LogLevel = DEFAULT_SETTINGS.developer.logLevel
let fileEnabled = DEFAULT_SETTINGS.developer.logToFile
let inited = false

let logDir = ''
let currentPath = ''
let currentDay = ''
let currentPart = 0
let currentBytes = 0

const pending: string[] = []
let flushTimer: ReturnType<typeof setTimeout> | null = null

const ring: LogEntry[] = []

// ===================== 脱敏 =====================

export { maskSecret, maskUrl, redact } from '@common/logSanitize'
import { redact, sanitizeText } from '@common/logSanitize'

// ===================== 文件写入 =====================

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0')
}

function dayStamp(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function timeStamp(ms: number): string {
  const d = new Date(ms)
  return `${dayStamp(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`
}

function partPath(day: string, part: number): string {
  return join(logDir, part === 0 ? `kunyin-${day}.log` : `kunyin-${day}.${part}.log`)
}

/** 切到当天（或当天下一片）的文件；失败则关掉文件输出，只留控制台。 */
function rollFile(): void {
  const day = dayStamp(new Date())
  if (day !== currentDay) {
    currentDay = day
    currentPart = 0
  }
  // Continue the highest existing part, without a fixed part-number ceiling.
  const parts = readdirSync(logDir)
    .map((f) => /^kunyin-(\d{4}-\d{2}-\d{2})(?:\.(\d+))?\.log$/.exec(f))
    .filter((m) => m && m[1] === currentDay)
    .map((m) => Number(m![2] ?? 0))
  currentPart = Math.max(currentPart, ...parts)
  currentPath = partPath(currentDay, currentPart)
  currentBytes = existsSync(currentPath) ? statSync(currentPath).size : 0
  if (currentBytes >= MAX_FILE_BYTES) {
    currentPath = partPath(currentDay, ++currentPart)
    currentBytes = 0
  }
}

/** 启动、写入及导出时清理；为下一批写入预留容量，无法清理则停止写盘。 */
function prune(reserve = 0): boolean {
  try {
    const files = readdirSync(logDir)
      .filter((f) => f.startsWith('kunyin-') && f.endsWith('.log'))
      .map((f) => {
        const full = join(logDir, f)
        try {
          const st = statSync(full)
          return { full, mtime: st.mtimeMs, size: st.size }
        } catch {
          return { full, mtime: 0, size: 0 }
        }
      })
      .sort((a, b) => a.mtime - b.mtime)

    const deadline = Date.now() - RETAIN_DAYS * 86400_000
    let total = files.reduce((s, f) => s + f.size, 0)
    for (const f of files) {
      if (f.full === currentPath) continue
      const tooOld = f.mtime < deadline
      const tooBig = total + reserve > MAX_DIR_BYTES
      if (!tooOld && !tooBig) break
      try {
        rmSync(f.full, { force: true })
        total -= f.size
      } catch {
        /* 占用中：下次启动再清 */
      }
    }
    return total + reserve <= MAX_DIR_BYTES
  } catch {
    return false
  }
}

function flush(): void {
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  if (!pending.length || !fileEnabled || !logDir) {
    pending.length = 0
    return
  }
  const lines = pending.splice(0)
  try {
    if (!prune(lines.reduce((sum, line) => sum + Buffer.byteLength(line), 0))) {
      fileEnabled = false
      return
    }
    for (const line of lines) {
      const bytes = Buffer.byteLength(line, 'utf-8')
      if (!currentPath || currentDay !== dayStamp(new Date())) rollFile()
      if (currentBytes + bytes > MAX_FILE_BYTES) {
        currentPath = partPath(currentDay, ++currentPart)
        currentBytes = 0
      }
      appendFileSync(currentPath, line, 'utf-8')
      currentBytes += bytes
    }
    prune()
  } catch {
    // 磁盘满/无权限：静默降级为「只输出控制台」，不再反复重试
    fileEnabled = false
  }
}

function scheduleFlush(): void {
  if (flushTimer || !fileEnabled) return
  flushTimer = setTimeout(flush, FLUSH_INTERVAL)
  flushTimer.unref?.()
}

// ===================== 记录 =====================

function formatLine(e: LogEntry): string {
  const head = `${timeStamp(e.time)} [${LEVEL_TAG[e.level]}] [${e.side}/${e.scope}] ${e.message}`
  return e.detail ? `${head} ${e.detail}\n` : `${head}\n`
}

function toDetail(detail: unknown): string | undefined {
  if (detail === undefined) return undefined
  try {
    const s = JSON.stringify(redact(detail))
    if (s === undefined) return undefined
    return s.length > MAX_DETAIL_CHARS ? `${s.slice(0, MAX_DETAIL_CHARS)}…截断` : s
  } catch {
    return '"[detail 序列化失败]"'
  }
}

function shouldLog(level: WritableLevel): boolean {
  return LOG_LEVEL_WEIGHT[level] >= LOG_LEVEL_WEIGHT[currentLevel]
}

/** 落一条已成形的记录（主进程自身与渲染层转发共用的唯一出口）。 */
let writing = false
export function writeEntry(entry: LogEntry): void {
  if (writing) return
  writing = true
  try {
    entry = {
      ...entry,
      scope: sanitizeText(entry.scope, 40),
      message: sanitizeText(entry.message),
      detail: entry.detail ? sanitizeText(entry.detail, MAX_DETAIL_CHARS) : undefined
    }
    if (!shouldLog(entry.level)) return
    ring.push(entry)
    if (ring.length > RING_SIZE) ring.splice(0, ring.length - RING_SIZE)

    const line = formatLine(entry)
    // 控制台：dev 下看终端，Release 下主进程 stdout 一般不可见，但附加到文件的同一份内容可查
    const sink =
      entry.level === 'error' ? console.error : entry.level === 'warn' ? console.warn : console.log
    try {
      sink(line.trimEnd())
    } catch {
      /* stdout may be closed; still write the file. */
    }

    if (!fileEnabled) return
    pending.push(line)
    // 警告与错误立刻落盘：崩溃前最后几条才是关键证据
    if (entry.level === 'warn' || entry.level === 'error' || pending.length > 200) flush()
    else scheduleFlush()
  } catch {
    /* Logging must never change application behavior. */
  } finally {
    writing = false
  }
}

function emit(
  side: LogSide,
  scope: string,
  level: WritableLevel,
  message: string,
  detail?: unknown
): void {
  if (!shouldLog(level)) return
  writeEntry({ time: Date.now(), level, side, scope, message, detail: toDetail(detail) })
}

/** 模块日志器。用 `createLogger('audio')` 取得，scope 会出现在每行前缀里。 */
export interface Logger {
  debug(message: string, detail?: unknown): void
  info(message: string, detail?: unknown): void
  warn(message: string, detail?: unknown): void
  /** error 的第二参可直接传 Error，会展开 name/message/stack */
  error(message: string, error?: unknown, detail?: Record<string, unknown>): void
  /** 计时：返回结束函数，调用时按 debug 记录耗时（ms） */
  time(message: string, detail?: unknown): (extra?: Record<string, unknown>) => void
  /** 派生子作用域，如 `log.child('kg')` → scope 变成 `audio:kg` */
  child(sub: string): Logger
  /** 当前级别是否会记录 debug —— 昂贵的 detail 组装前先问一句 */
  readonly verbose: boolean
}

function makeLogger(side: LogSide, scope: string): Logger {
  return {
    debug: (m, d) => emit(side, scope, 'debug', m, d),
    info: (m, d) => emit(side, scope, 'info', m, d),
    warn: (m, d) => emit(side, scope, 'warn', m, d),
    error: (m, err, d) =>
      emit(
        side,
        scope,
        'error',
        m,
        err === undefined && d === undefined ? undefined : { detail: d, err }
      ),
    time: (m, d) => {
      const start = Date.now()
      return (extra) =>
        emit(side, scope, 'debug', m, { detail: d, extra, costMs: Date.now() - start })
    },
    child: (sub) => makeLogger(side, `${scope}:${sub}`),
    get verbose() {
      return shouldLog('debug')
    }
  }
}

/** 建一个模块日志器（主进程用）。 */
export function createLogger(scope: string): Logger {
  return makeLogger('main', scope)
}

/** 渲染层转发进来的日志：保留原始 side/scope/时间戳。 */
export function writeRendererEntry(entry: LogEntry): void {
  if (
    !entry ||
    typeof entry !== 'object' ||
    typeof entry.message !== 'string' ||
    !['debug', 'info', 'warn', 'error'].includes(entry.level) ||
    typeof entry.scope !== 'string' ||
    (entry.detail !== undefined && typeof entry.detail !== 'string')
  )
    return
  const level: WritableLevel = LEVEL_TAG[entry.level] ? entry.level : 'info'
  writeEntry({
    time: Number.isFinite(entry.time) ? entry.time : Date.now(),
    level,
    side: entry.side === 'lyric-window' ? 'lyric-window' : 'renderer',
    scope: String(entry.scope || 'app').slice(0, 40),
    message: entry.message.slice(0, 2000),
    detail: typeof entry.detail === 'string' ? entry.detail.slice(0, MAX_DETAIL_CHARS) : undefined
  })
}

// ===================== 生命周期 =====================

export function setLogLevel(level: LogLevel): void {
  if (level === currentLevel) return
  currentLevel = level
  log.info('日志级别已切换', { level })
}

export function getLogLevel(): LogLevel {
  return currentLevel
}

export function setLogToFile(enabled: boolean): void {
  if (enabled === fileEnabled) return
  if (!enabled) flush()
  fileEnabled = enabled
  if (enabled && logDir) {
    try {
      rollFile()
    } catch {
      fileEnabled = false
    }
  }
}

/** 最近若干条（新→旧），设置页「查看最近日志」用。 */
export function getRecentLogs(limit = RING_SIZE): LogEntry[] {
  return ring
    .slice(
      -Math.max(1, Math.min(RING_SIZE, Number.isFinite(limit) ? Math.floor(limit) : RING_SIZE))
    )
    .reverse()
    .map((e) => ({ ...e }))
}

export function getLogFileInfo(): LogFileInfo {
  let totalBytes = 0
  let fileCount = 0
  try {
    for (const f of readdirSync(logDir)) {
      if (!f.startsWith('kunyin-') || !f.endsWith('.log')) continue
      fileCount += 1
      try {
        totalBytes += statSync(join(logDir, f)).size
      } catch {
        /* 忽略单个文件统计失败 */
      }
    }
  } catch {
    /* 目录还不存在 */
  }
  return { dir: logDir, current: currentPath, totalBytes, fileCount }
}

/** 把内存里最近的日志导出为一个独立文件，返回路径（失败返回 null）。 */
export function dumpRecentLogs(): string | null {
  try {
    flush()
    const d = new Date()
    const name = `kunyin-dump-${dayStamp(d)}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.log`
    const target = join(logDir, name)
    const header = [
      `坤音日志导出 ${timeStamp(Date.now())}`,
      `版本 ${app.getVersion()}  平台 ${process.platform} ${process.arch}`,
      `Electron ${process.versions.electron}  Chrome ${process.versions.chrome}  Node ${process.versions.node}`,
      `日志级别 ${currentLevel}  写入文件 ${fileEnabled}`,
      ''
    ].join('\n')
    const content = header + ring.map(formatLine).join('')
    if (!prune(Buffer.byteLength(content))) return null
    writeFileSync(target, content, 'utf-8')
    prune()
    return target
  } catch {
    return null
  }
}

/**
 * 启动早期调用一次（须在 initAppDataDir 之后、其他模块初始化之前）。
 * 幂等；重复调用只刷新级别配置。
 */
export function initLogger(level: LogLevel, toFile: boolean): void {
  currentLevel = level
  fileEnabled = toFile
  if (inited) return
  inited = true

  try {
    logDir = appDataPath('logs')
    mkdirSync(logDir, { recursive: true })
  } catch {
    fileEnabled = false
  }
  if (fileEnabled) {
    try {
      rollFile()
      prune()
    } catch {
      fileEnabled = false
    }
  }

  // 退出前把缓冲里的最后几条写下去
  app.on('before-quit', flush)
  app.on('will-quit', flush)
  process.on('exit', flush)

  // Monitor only: do not install uncaughtException handlers that suppress the original crash.
  process.on('uncaughtExceptionMonitor', (err) => {
    log.error('未捕获异常（主进程）', err)
    flush()
  })
  process.on('unhandledRejection', (reason) => {
    log.error('未处理的 Promise 拒绝（主进程）', reason)
    flush()
  })

  log.info('日志已启动', {
    level: currentLevel,
    toFile: fileEnabled,
    dir: logDir,
    version: app.getVersion(),
    platform: `${process.platform}-${process.arch}`,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    packaged: app.isPackaged
  })
}

/** 通用日志器（没有明确模块归属时用） */
export const log = createLogger('app')
