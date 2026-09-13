/**
 * 日志共享契约（主进程 / preload / 渲染层共用）。
 *
 * 渲染层的日志经 IPC 汇到主进程统一落盘，排查问题时一份文件就能看到
 * 「点了播放 → 主进程取流 → 解密 → <audio> 报错」的完整因果链。
 */

/** 日志级别，按严重程度递增；silent 表示完全关闭。 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent'

/** 级别权重，用于阈值比较（越大越严重） */
export const LOG_LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100
}

/** 设置页的级别下拉选项 */
export const LOG_LEVEL_LIST: { id: LogLevel; label: string }[] = [
  { id: 'debug', label: '调试（最详细，排查问题用）' },
  { id: 'info', label: '常规（默认）' },
  { id: 'warn', label: '仅警告与错误' },
  { id: 'error', label: '仅错误' },
  { id: 'silent', label: '关闭日志' }
]

/** 日志来源进程。 */
export type LogSide = 'main' | 'renderer' | 'lyric-window'

/** 一条日志记录（渲染层 → 主进程的传输单元，也是内存环形缓冲的元素）。 */
export interface LogEntry {
  /** 毫秒时间戳 */
  time: number
  level: Exclude<LogLevel, 'silent'>
  side: LogSide
  /** 模块名，如 audio / player / kg */
  scope: string
  message: string
  /** 结构化附加字段（已脱敏）。序列化后不超过 ~4KB。 */
  detail?: string
}

/** 日志文件概况（设置页展示 / 导出用） */
export interface LogFileInfo {
  dir: string
  /** 当前正在写入的文件绝对路径 */
  current: string
  /** 日志目录总占用字节 */
  totalBytes: number
  fileCount: number
}
