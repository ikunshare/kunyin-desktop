import type { BaseLyricPlayerConfig } from '../config'

export class Driver {
  private frameId: ReturnType<typeof globalThis.requestAnimationFrame> | null = null
  private timerId: ReturnType<typeof globalThis.setTimeout> | null = null

  schedule(driver: BaseLyricPlayerConfig.RootRequired['driver'], callback: () => void) {
    switch (driver) {
      case 'animation':
        this.frameId = globalThis.requestAnimationFrame(callback)
        break
      case 'timer':
        this.timerId = globalThis.setTimeout(callback, 16)
        break
    }
  }

  cancel() {
    if (this.frameId !== null) {
      globalThis.cancelAnimationFrame(this.frameId)
      this.frameId = null
    }
    if (this.timerId !== null) {
      globalThis.clearTimeout(this.timerId)
      this.timerId = null
    }
  }
}
