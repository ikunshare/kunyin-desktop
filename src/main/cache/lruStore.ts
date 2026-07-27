/**
 * 缓存通用件：带 LRU 上限的 JSON 持久化 Map（原子写：tmp + rename，防抖 500ms）。
 * URL 缓存（时效短）与歌词缓存（长期）共用此骨架，参考 lx-music-desktop 的 Store 写法。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { appDataPath, DATA_CACHE_SUBDIR } from '../core/paths'

export class LruJsonStore<V> {
  private map = new Map<string, V>()
  private saveTimer: NodeJS.Timeout | null = null
  private loaded = false

  constructor(
    private readonly fileName: string,
    private readonly capacity: number
  ) {}

  private filePath(): string {
    return appDataPath(DATA_CACHE_SUBDIR, this.fileName)
  }

  private ensureLoaded(): void {
    if (this.loaded) return
    this.loaded = true
    try {
      const raw = readFileSync(this.filePath(), 'utf-8')
      const entries = JSON.parse(raw) as [string, V][]
      if (Array.isArray(entries)) this.map = new Map(entries)
    } catch {
      /* 首次或文件损坏：空缓存 */
    }
  }

  get(key: string): V | undefined {
    this.ensureLoaded()
    const v = this.map.get(key)
    if (v === undefined) return undefined
    // 触碰：提到最新（Map 迭代序即 LRU 序）
    this.map.delete(key)
    this.map.set(key, v)
    return v
  }

  set(key: string, value: V): void {
    this.ensureLoaded()
    this.map.delete(key)
    this.map.set(key, value)
    while (this.map.size > this.capacity) {
      const oldest = this.map.keys().next().value
      if (oldest === undefined) break
      this.map.delete(oldest)
    }
    this.persist()
  }

  delete(key: string): void {
    this.ensureLoaded()
    if (this.map.delete(key)) this.persist()
  }

  /** 当前条目数（设置页「缓存管理」展示用） */
  size(): number {
    this.ensureLoaded()
    return this.map.size
  }

  /** 清空并立刻落盘（清理按钮：不走防抖，避免清完就退出导致文件还是旧的） */
  clear(): void {
    this.ensureLoaded()
    this.map.clear()
    this.flush()
  }

  /** 同步写盘，取消待执行的防抖任务 */
  private flush(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    this.write()
  }

  private persist(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      this.write()
    }, 500)
  }

  private write(): void {
    try {
      const path = this.filePath()
      const dir = appDataPath(DATA_CACHE_SUBDIR)
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      const tmp = `${path}.tmp`
      writeFileSync(tmp, JSON.stringify([...this.map.entries()]), 'utf-8')
      renameSync(tmp, path)
    } catch {
      /* 持久化失败不影响内存缓存 */
    }
  }
}
