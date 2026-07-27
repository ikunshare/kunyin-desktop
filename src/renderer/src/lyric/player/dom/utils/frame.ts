export class FrameScheduler {
  private frameId: number | null = null
  private isDestroyed = false

  request(callback: () => void) {
    if (this.isDestroyed) {
      return
    }

    this.cancel()

    this.frameId = requestAnimationFrame(() => {
      this.frameId = null

      if (this.isDestroyed) {
        return
      }

      callback()
    })
  }

  cancel() {
    if (this.frameId !== null) {
      cancelAnimationFrame(this.frameId)
      this.frameId = null
    }
  }

  destroy() {
    this.isDestroyed = true
    this.cancel()
  }
}
