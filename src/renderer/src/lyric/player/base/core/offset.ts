import { Lyric } from '../../../kit/lyric'

export class Offset {
  private temp = 0
  private meta = 0

  setTemp(value: number) {
    this.temp = Number.isFinite(value) ? value : 0
  }

  resetTemp() {
    this.temp = 0
  }

  refreshFromMeta(info: Lyric.Parsed.Info, useMeta: boolean) {
    if (!useMeta) {
      this.meta = 0
      return
    }

    const value = info.meta?.offset
    this.meta = typeof value === 'number' && Number.isFinite(value) ? value : 0
  }

  resolve(global: number): number {
    const value = global + this.meta + this.temp
    return Number.isFinite(value) ? value : 0
  }
}
