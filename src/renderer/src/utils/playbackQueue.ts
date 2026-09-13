/** 随机播放保留历史；预览下一首与实际切歌使用同一个结果。 */
export class PlaybackQueue {
  private history: string[] = []
  private cursor = -1
  private pending: string | null = null
  private visited = new Set<string>()

  reset(): void {
    this.history = []
    this.cursor = -1
    this.pending = null
    this.visited.clear()
  }

  record(key: string): void {
    if (this.history[this.cursor] === key) return
    this.history = this.history.slice(0, this.cursor + 1)
    this.history.push(key)
    this.cursor = this.history.length - 1
    this.visited.add(key)
    this.pending = null
  }

  peek(keys: string[], current: string): string | undefined {
    const future = this.history.slice(this.cursor + 1).find((key) => keys.includes(key))
    if (future) return future
    if (this.pending && keys.includes(this.pending) && this.pending !== current) return this.pending
    let candidates = keys.filter((key) => key !== current && !this.visited.has(key))
    if (!candidates.length) {
      this.visited.clear()
      this.visited.add(current)
      candidates = keys.filter((key) => key !== current)
    }
    this.pending = candidates[Math.floor(Math.random() * candidates.length)] ?? keys[0] ?? null
    return this.pending ?? undefined
  }

  move(keys: string[], current: string, delta: number): string | undefined {
    if (delta < 0) {
      for (let i = this.cursor - 1; i >= 0; i--) {
        if (!keys.includes(this.history[i])) continue
        this.cursor = i
        this.pending = null
        return this.history[i]
      }
      return undefined
    }
    const key = this.peek(keys, current)
    if (!key) return undefined
    const future = this.history.indexOf(key, this.cursor + 1)
    if (future >= 0) this.cursor = future
    else this.record(key)
    return key
  }
}
