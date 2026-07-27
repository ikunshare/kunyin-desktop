import { Lyric } from '../../../kit/lyric'

export class Merger {
  private lines: Lyric.Parsed.ParsedLine[] = []
  private mergedEnd: number[] = []

  /**
   * Raw deactivation time of a line: the later of its own end and the next line's start.
   *
   * The final line never deactivates, and out-of-range indices resolve to 0.
   */
  private getRawTime(index: number): number {
    const lines = this.lines
    if (index < 0 || index >= lines.length) {
      return 0
    }

    if (index === lines.length - 1) {
      return Infinity
    }

    return Math.max(
      Lyric.Parsed.getParsedLineTime(lines[index])!.end,
      Lyric.Parsed.getParsedLineTime(lines[index + 1])!.start
    )
  }

  /**
   * Rebuild the merged end-time table from the given lines and merge settings.
   */
  build(lines: Lyric.Parsed.ParsedLine[], mergeWindow: number, mergeLimit: number) {
    this.lines = lines

    const count = lines.length
    const merged: number[] = new Array(count)
    if (count === 0) {
      this.mergedEnd = merged
      return
    }

    const threshold = Math.max(0, mergeWindow)
    // Cap on how many lines may fold into one batch; `0` or less means unbounded.
    const limit = mergeLimit > 0 ? mergeLimit : Infinity

    let nextRaw = this.getRawTime(count - 1)
    merged[count - 1] = nextRaw
    // Lines accumulated in the current batch, counted back from its later end.
    let batchSize = 1
    for (let i = count - 2; i >= 0; i--) {
      const raw = this.getRawTime(i)
      // Within threshold of the next line's deactivation and the batch still has room: extend to the cluster's later end so they leave together; `max` guarantees a line is never cut short.
      if (threshold > 0 && batchSize < limit && Math.abs(nextRaw - raw) < threshold) {
        merged[i] = Math.max(raw, merged[i + 1])
        batchSize++
      } else {
        // Out of threshold, or the batch hit its cap: force-flush here so this line starts a fresh batch.
        merged[i] = raw
        batchSize = 1
      }
      nextRaw = raw
    }

    this.mergedEnd = merged
  }

  /**
   * Merged deactivation time of a line, falling back to the raw time when unbuilt.
   */
  getMergedTime(index: number): number {
    const value = this.mergedEnd[index]
    return value === undefined ? this.getRawTime(index) : value
  }
}
