import { BasePlugin } from './base'

export class PluginLoader<T extends BasePlugin> {
  private current: Map<string, T> = new Map()

  private cache: Map<unknown, T[]> = new Map()
  private sortedCache: Map<unknown, T[]> = new Map()

  /**
   * Invalidate the stage grouping caches after any mutation.
   */
  private invalidate() {
    this.cache.clear()
    this.sortedCache.clear()
  }

  get(id: string) {
    return this.current.get(id)
  }

  add(plugin: T, overwrite = false) {
    const id = plugin.id
    if (!id || typeof id !== 'string') {
      return
    }

    const exist = this.current.get(id)
    if (exist && !overwrite) {
      return
    }

    this.current.set(id, plugin)
    this.invalidate()
  }

  delete(id: string): boolean
  delete(plugin: T): boolean
  delete(content: string | T) {
    const id = typeof content === 'string' ? content : content?.id
    if (!id || typeof id !== 'string') {
      return false
    }

    const deleted = this.current.delete(id)
    if (deleted) {
      this.invalidate()
    }
    return deleted
  }

  clear() {
    this.invalidate()
    return this.current.clear()
  }

  keys() {
    return [...this.current.keys()]
  }

  filterByStage<S>(stage: S, sort: boolean = false): T[] {
    if (sort) {
      const cached = this.sortedCache.get(stage)
      if (cached) {
        return cached
      }
    } else {
      const cached = this.cache.get(stage)
      if (cached) {
        return cached
      }
    }

    const target: T[] = []
    for (const item of this.current.values()) {
      if (item.stage === stage) {
        target.push(item)
      }
    }

    if (sort) {
      target.sort((a, b) => (Number(a.priority) || 100) - (Number(b.priority) || 100))
      this.sortedCache.set(stage, target)
    } else {
      this.cache.set(stage, target)
    }

    return target
  }
}
