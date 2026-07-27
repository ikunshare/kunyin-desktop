import type { LineElementStyle } from '../components'
import type { CoreContext } from './context'
import type { LineManager } from './line'

import { DomLyricPlayerConfig } from '../config'
import { LineElementType } from '../components'

const GAUSSIAN_SIGMA = 2.2

// Beyond this offset the gaussian falls below ~0.02% and is visually indistinguishable from its limit, so far lines skip the exp entirely.
const GAUSSIAN_CUTOFF = 4 * GAUSSIAN_SIGMA

// Assumed line height before any line is measured, used to size the content window on the first pass.
const ESTIMATED_LINE_HEIGHT = 40

// Lower bound on the per-line height used for window sizing, so a pathologically small line can't blow up the window.
const MIN_COVERAGE_UNIT = 16

export interface TransitionResult {
  duration: number
  delay: number
}

export class LayoutManager {
  private previousLineIndex = -1
  private previousActiveLineIndexes: number[] = []
  // Last applied scroll offset; entrants seed from here so a seek slides in instead of snapping.
  private previousOffset: number | undefined = undefined

  constructor(
    private readonly context: CoreContext,
    private readonly lineManager: LineManager
  ) {}

  private gaussian(offset: number): number {
    if (offset > GAUSSIAN_CUTOFF || offset < -GAUSSIAN_CUTOFF) {
      return 0
    }
    return Math.exp(-(offset * offset) / (2 * GAUSSIAN_SIGMA * GAUSSIAN_SIGMA))
  }

  private round(value: number, precision = 2): number {
    const factor = 10 ** precision
    return Math.round(value * factor) / factor
  }

  private calcScale(
    config: DomLyricPlayerConfig.RootRequired['effect']['scale'],
    gaussian: number
  ): number | undefined {
    if (!config.enabled) {
      return undefined
    }

    const min = Math.max(config.min, 0)
    const max = Math.max(config.max, min)

    return this.round(min + (max - min) * gaussian)
  }

  private calcBlur(
    config: DomLyricPlayerConfig.RootRequired['effect']['blur'],
    gaussian: number
  ): number {
    if (!config.enabled) {
      return 0
    }

    const min = Math.max(config.min, 0)
    const max = Math.max(config.max, min)

    return this.round(min + (max - min) * (1 - gaussian))
  }

  private calcTransition(
    config: DomLyricPlayerConfig.RootRequired['scroll']['animation'],
    offset: number,
    played: boolean,
    direction: number
  ): TransitionResult {
    const duration = Math.max(config.duration, 0)

    switch (config.mode) {
      case DomLyricPlayerConfig.Scroll.Animation.Mode.Smooth: {
        return {
          duration,
          delay: Math.max(config.smooth.delay, 0)
        }
      }
      case DomLyricPlayerConfig.Scroll.Animation.Mode.Ripple: {
        const step = Math.max(config.ripple.step, 10)
        const range = Math.max(config.ripple.range, 1)
        const distance = Math.min(Math.abs(offset), range)
        const normalized = distance / range
        const eased = 1 - (1 - normalized) ** 2

        return {
          duration,
          delay: Math.round(eased * range * step)
        }
      }
      case DomLyricPlayerConfig.Scroll.Animation.Mode.Directional: {
        const step = Math.max(config.directional.step, 10)
        const range = Math.max(config.directional.range, 1)
        const distance = Math.min(Math.abs(offset), range)
        const normalized = distance / range

        if (played) {
          const eased = (1 - normalized) ** 2
          return {
            duration,
            delay: Math.round(eased * range * step)
          }
        }

        const eased = 1 - (1 - normalized) ** 2
        return {
          duration,
          delay: Math.round(eased * range * step)
        }
      }
      case DomLyricPlayerConfig.Scroll.Animation.Mode.Stagger: {
        if (direction === 0) {
          return {
            duration,
            delay: 0
          }
        }

        const range = Math.max(config.stagger.range, 1)
        const step = Math.max(config.stagger.step, 1)

        const clamped = Math.max(-range, Math.min(range, offset))
        const result = (range + direction * clamped) * step

        return {
          duration,
          delay: Math.round(result)
        }
      }
      default: {
        return {
          duration,
          delay: 0
        }
      }
    }
  }

  update(force = false) {
    const { player, config, component, scroll } = this.context

    const elementCount = this.lineManager.elementSize
    if (!elementCount || !player.currentInfo.lines.length) {
      return
    }

    const isHideInterlude = this.context.config.current.line.interlude.style.normal.hide

    const isInPlay = player.currentPlaying
    const isInScroll = scroll.active

    const effectConfig = config.current.effect
    const scaleConfig = effectConfig.scale
    const blurConfig = effectConfig.blur
    const transitionConfig = config.current.scroll.animation

    const currentSpace = Math.max(0, config.current.layout.gap)
    const currentContainerHeight = Math.max(0, component.container.height)

    // Lines within this many elements of the active line keep their animations built and stay layer-promoted; the buffer also lets a just-passed line finish its wind-down before release.
    const animationWindow = Math.max(0, Math.floor(config.current.line.animationWindow))

    const activePercent = Math.min(Math.max(config.current.scroll.anchor, 0), 100)
    const activePosition = currentContainerHeight * (activePercent / 100)

    // Cached insertion-ordered element list from the line manager
    // So the rest of `update` can use O(1) array indexing without re-materializing the map each pass.
    const elements = this.lineManager.elementList

    let activeElementSet: ReadonlySet<number>
    let firstActiveElementIndex: number

    const cachedActiveSet = this.lineManager.queryActiveElementSet(player.currentIndex)
    if (cachedActiveSet.size > 0) {
      activeElementSet = cachedActiveSet
      // Only the first active element index is needed below; read it from the set without materializing an array.
      firstActiveElementIndex = cachedActiveSet.values().next().value ?? 0
    } else {
      // No active elements (e.g. before the song starts). Fall back to line 0
      const fallback = this.lineManager.queryElementIndexes(0) ?? [0]
      activeElementSet = new Set(fallback)
      firstActiveElementIndex = fallback[0] ?? 0
    }

    // Scroll-aware active index, also used to center the content window; clamped so it can't index out of range.
    const rawFirstActiveIndex = isInScroll
      ? (this.lineManager.queryElementIndexes(scroll.activeIndex)?.[0] ?? firstActiveElementIndex)
      : firstActiveElementIndex
    const firstActiveIndex = Math.min(Math.max(rawFirstActiveIndex, 0), elementCount - 1)

    // Build enough lines to cover half the viewport each side (the active line is centered) plus a small lead-in buffer.
    // Coverage uses the smallest measured line height so short lines (small font) don't leave on-screen gaps.
    const coverageUnit = Math.max(
      MIN_COVERAGE_UNIT,
      this.lineManager.minMeasuredHeight(ESTIMATED_LINE_HEIGHT)
    )
    const dynamicFloor = Math.ceil(currentContainerHeight / 2 / coverageUnit) + 2

    const contentWindow = Math.max(0, Math.floor(config.current.line.contentWindow))
    const contentRadius = Math.max(contentWindow, animationWindow, dynamicFloor)
    const entrants = this.lineManager.updateWindow(
      firstActiveIndex,
      contentRadius,
      activeElementSet
    )

    const topPositions: number[] = new Array(elementCount)

    for (let i = 0; i < elementCount; i++) {
      const element = elements[i]

      if (!element) {
        topPositions[i] = 0
        continue
      }

      if (i === 0) {
        topPositions[i] = 0
        continue
      }

      const lastTop = topPositions[i - 1]
      const lastElement = elements[i - 1]
      const lastHeight = lastElement ? this.lineManager.getHeight(lastElement) : 0
      const baseTop = lastTop + lastHeight

      // [vendor patch] 原「背景行非激活不占高（叠进上行）、激活占高推挤后续行」分支已删除：
      // 背景人声改为主行行内子行，主行高度天然包含它，无需特判。

      if (element.type === LineElementType.Interlude && isHideInterlude) {
        const isActiveElement = activeElementSet.has(i)
        if (!isInScroll && !isActiveElement) {
          topPositions[i] = baseTop - this.lineManager.getHeight(element)
          continue
        }
      }

      topPositions[i] = baseTop + currentSpace
    }

    const firstElement = elements[firstActiveIndex]
    const firstElementHeight = firstElement ? this.lineManager.getHeight(firstElement) : 0

    const currentActiveOffset = topPositions[firstActiveIndex] + firstElementHeight / 2
    const currentOffset = activePosition - currentActiveOffset
    const currentTime = player.currentTime

    // Seed entrants at the previous offset (or the current one on first layout) so they transition in from there.
    // Apply the seed with transitions off, then the style loop below animates them from there to target.
    if (entrants.length > 0) {
      const seedOffset = this.previousOffset ?? currentOffset
      for (const i of entrants) {
        elements[i]?.updateStyle({ top: topPositions[i] + seedOffset, left: 0, scale: 1 }, true)
      }
      // Reading `offsetHeight` forces one synchronous reflow that commits the hidden seed writes above.
      void this.context.component.container.element.offsetHeight
      for (const i of entrants) {
        const element = elements[i]
        if (element) {
          element.element.style.visibility = ''
        }
      }
    }

    const activeIndex = firstActiveElementIndex

    const currentLineIndex = player.currentIndex[0] ?? -1
    const currentDirection =
      !isInScroll && this.previousLineIndex !== -1 && currentLineIndex !== this.previousLineIndex
        ? currentLineIndex > this.previousLineIndex
          ? 1
          : -1
        : 0

    const currentLineIndexSet = new Set(player.currentIndex)
    const exitingLineIndexes = this.previousActiveLineIndexes.filter(
      (index) => !currentLineIndexSet.has(index)
    )
    const isExitingGroup =
      !isInScroll &&
      currentDirection > 0 &&
      this.previousActiveLineIndexes.length > 1 &&
      exitingLineIndexes.length === this.previousActiveLineIndexes.length
    const exitingElementSet = new Set<number>()

    if (isExitingGroup) {
      for (const lineIndex of exitingLineIndexes) {
        for (const elementIndex of this.lineManager.queryElementIndexes(lineIndex) ?? []) {
          exitingElementSet.add(elementIndex)
        }
      }
    }

    // Reuse a single style object across iterations of the per-element loop
    // below to avoid allocating a fresh one per line on every layout pass.
    const currentStyle: LineElementStyle = {}

    // Style and drive only attached (windowed) elements — off-window lines are detached and need no per-frame work.
    for (const i of this.lineManager.attachedIndexes) {
      const element = elements[i]
      if (!element) {
        continue
      }

      const isPlayedLine = i < activeIndex
      const isActiveLine = activeElementSet.has(i)
      const isAlreadyActive = element.active

      if (isInPlay) {
        element.active = isActiveLine
        element.played = isPlayedLine
      }

      const indexOffset = i - activeIndex

      // reset style
      currentStyle.top = topPositions[i] + currentOffset
      currentStyle.opacity = undefined
      currentStyle.scale = undefined
      currentStyle.blur = undefined
      currentStyle.hide = false

      if (isInScroll) {
        currentStyle.opacity = 1
        currentStyle.transitionDelay = 0
        currentStyle.transitionDuration = 200
      } else {
        const transition = this.calcTransition(
          transitionConfig,
          indexOffset,
          isPlayedLine,
          currentDirection
        )

        currentStyle.transitionDuration = exitingElementSet.has(i)
          ? Math.max(transition.duration, 450)
          : transition.duration
        currentStyle.transitionDelay = transition.delay

        if (exitingElementSet.has(i)) {
          currentStyle.scale = 1
          currentStyle.blur = 0
        } else if (!isActiveLine) {
          const gaussian = this.gaussian(indexOffset)
          currentStyle.scale = this.calcScale(scaleConfig, gaussian)
          currentStyle.blur = this.calcBlur(blurConfig, gaussian)
          if (element.type === LineElementType.Interlude && isHideInterlude) {
            currentStyle.hide = true
          }
        }
      }

      // [vendor patch] 原「背景行 enter/retract 延迟」计算已随独立背景行删除。

      // `isActiveLine` always wins so duet / background active elements keep animations even past the window.
      element.animatable = isActiveLine || Math.abs(indexOffset) <= animationWindow

      element.updateStyle(currentStyle)

      if (!isActiveLine) {
        element.reset(currentTime)
        continue
      }

      if (force || !isAlreadyActive) {
        if (isInPlay) {
          element.play(currentTime, true)
        } else {
          element.pause(currentTime, true)
        }
      }
    }

    this.previousLineIndex = currentLineIndex
    this.previousActiveLineIndexes = player.currentIndex.slice()
    this.previousOffset = currentOffset
  }

  reset() {
    this.previousLineIndex = -1
    this.previousActiveLineIndexes = []
    this.previousOffset = undefined
  }
}
