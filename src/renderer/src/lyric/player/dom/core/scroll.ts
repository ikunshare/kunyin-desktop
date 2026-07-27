import type { CoreContext } from './context'

export class ScrollManager {
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly context: CoreContext,
    private readonly handleScroll: (line: number, scrolling: boolean) => void
  ) {
    this.context.component.container.event.add('wheel', this.onWheel)
  }

  private onWheel = (e: WheelEvent) => {
    e.preventDefault()

    const { player, scroll } = this.context

    const currentLines = player.currentInfo.lines
    if (!currentLines.length) {
      return
    }

    const direction = e.deltaY > 0 ? 1 : e.deltaY < 0 ? -1 : 0
    if (direction === 0) {
      return
    }

    if (scroll.activeIndex === -1) {
      scroll.activeIndex = player.currentIndex[0] ?? 0
    }

    const nextIndex = scroll.activeIndex + direction

    if (nextIndex < 0 || nextIndex >= currentLines.length) {
      this.updateTimer()
      return
    }

    scroll.active = true
    scroll.activeIndex = nextIndex

    this.handleScroll(nextIndex, true)
    this.updateTimer()
  }

  private updateTimer() {
    this.clearTimer()

    this.timer = setTimeout(() => {
      const { scroll } = this.context

      scroll.active = false
      scroll.activeIndex = -1
      this.timer = null

      this.handleScroll(-1, false)
    }, 3 * 1000)
  }

  private clearTimer() {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  clear() {
    const { scroll } = this.context

    this.clearTimer()

    scroll.active = false
    scroll.activeIndex = -1

    this.handleScroll(-1, false)
  }

  destroy() {
    this.clear()
    this.context.component.container.event.remove('wheel', this.onWheel)
  }

  get current() {
    return {
      scrolling: this.context.scroll.active,
      active: this.context.scroll.activeIndex
    }
  }
}
