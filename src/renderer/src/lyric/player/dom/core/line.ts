import type { LineElement } from '../components'
import type { DomLyricPlayerConfig } from '../config'
import type { CoreContext } from './context'

import { Lyric } from '../../../kit/lyric'
import { hasKeyContaining } from '../../utils'
import { NormalLineElement, InterludeLineElement, LineElementType } from '../components'

// Height used for an off-window line before any line of its kind has been measured; the layout only uses it off-screen.
const FALLBACK_LINE_HEIGHT = 50

export class LineManager {
  private currentElementMap: Map<number, LineElement> = new Map()
  private currentIndexMap: Map<number, number[]> = new Map()

  // Insertion-ordered snapshot of `currentElementMap`, rebuilt only on membership change so layout can index it without re-materializing the map each pass.
  private currentElementList: LineElement[] = []

  private cachedActiveLineIndexes: number[] = []
  private cachedActiveSet: ReadonlySet<number> = new Set()

  // Element indexes currently attached to the DOM with content built (the virtualized window).
  private attachedSet: Set<number> = new Set()

  // Last measured height per line kind, used to estimate off-window lines for the prefix-sum layout.
  private heightEstimate: Map<string, number> = new Map()

  constructor(private readonly context: CoreContext) {}

  // [vendor patch] 背景人声不再产生独立 element（由 NormalLineElement 行内渲染），
  // 桶位只留主行与间奏两类。
  private heightBucket(element: LineElement): string {
    return element.type === LineElementType.Normal ? 'normal-main' : 'interlude'
  }

  private recordHeight(element: LineElement) {
    if (element.measured && element.height > 0) {
      this.heightEstimate.set(this.heightBucket(element), element.height)
    }
  }

  get elementMap(): ReadonlyMap<number, LineElement> {
    return this.currentElementMap
  }

  get elementList(): readonly LineElement[] {
    return this.currentElementList
  }

  get elementSize() {
    return this.currentElementMap.size
  }

  get indexMap(): ReadonlyMap<number, number[]> {
    return this.currentIndexMap
  }

  /**
   * Element indexes currently attached to the DOM; layout styles only these.
   */
  get attachedIndexes(): ReadonlySet<number> {
    return this.attachedSet
  }

  isActiveElement(element: number, current: number[]): boolean {
    for (const lineIndex of current) {
      const indexes = this.currentIndexMap.get(lineIndex)
      if (indexes && indexes.includes(element)) {
        return true
      }
    }
    return false
  }

  queryActiveElementSet(lineIndexes: number[]): ReadonlySet<number> {
    const cachedKeys = this.cachedActiveLineIndexes
    if (cachedKeys.length === lineIndexes.length) {
      let same = true
      for (let i = 0; i < lineIndexes.length; i++) {
        if (lineIndexes[i] !== cachedKeys[i]) {
          same = false
          break
        }
      }
      if (same) {
        return this.cachedActiveSet
      }
    }

    const result = new Set<number>()

    for (const lineIndex of lineIndexes) {
      const indexes = this.currentIndexMap.get(lineIndex)
      if (!indexes) {
        continue
      }
      for (const index of indexes) {
        result.add(index)
      }
    }

    this.cachedActiveLineIndexes = lineIndexes.slice()
    this.cachedActiveSet = result
    return result
  }

  queryElement(index: number): LineElement | undefined {
    return this.currentElementMap.get(index)
  }

  queryElementIndexes(lineIndex: number): number[] | undefined {
    return this.currentIndexMap.get(lineIndex)
  }

  updateLines(info: Lyric.Parsed.Info) {
    const { component } = this.context

    const isSyllable = info.timing === Lyric.Common.Timing.WORD

    const newElementMap = new Map<number, LineElement>()
    const newIndexMap = new Map<number, number[]>()

    let lineIndex = 0
    let elementIndex = 0

    for (const line of info.lines) {
      const currentLineIndex = lineIndex
      const currentElementIndex = elementIndex
      const indexes: number[] = []

      lineIndex++
      elementIndex++

      if (Lyric.Parsed.isParsedLineInterlude(line)) {
        const element = new InterludeLineElement(component.context, line.body.value)
        newElementMap.set(currentElementIndex, element)
        indexes.push(currentElementIndex)

        newIndexMap.set(currentLineIndex, indexes)
        continue
      }

      if (Lyric.Parsed.isParsedLineNormal(line)) {
        // [vendor patch] backgrounds 不再各建一个 NormalLineElement（原实现：与主行共享 lineIndex、
        // 非激活不占高、激活浮现推高后续行），改由主行行内渲染子行，每行恒为一个 element。
        const element = new NormalLineElement(component.context, line.body.value, isSyllable)
        element.index = currentLineIndex
        newElementMap.set(currentElementIndex, element)
        indexes.push(currentElementIndex)

        newIndexMap.set(currentLineIndex, indexes)
      }
    }

    this.clear()

    this.currentElementMap = newElementMap
    this.currentIndexMap = newIndexMap
    this.currentElementList = Array.from(newElementMap.values())

    // Wrappers are attached lazily by updateWindow; nothing is added to the container here.
    this.updateAlign()
  }

  updateAlign() {
    const { layout } = this.context.config.current

    const align = layout.align
    if (!layout.duet.enabled) {
      for (const element of this.currentElementMap.values()) {
        element.position = align
      }
      return
    }

    let current: DomLyricPlayerConfig.Layout.AlignValue = align
    let lastId: string | undefined = undefined
    for (const element of this.currentElementMap.values()) {
      if (element.type === LineElementType.Interlude) {
        element.position = align
        continue
      }

      // [vendor patch] 无背景独立行，所有 normal 行都参与 duet 的左右交替判定。
      const agentId = element.info.agents[0]
      if (agentId !== undefined) {
        if (lastId !== undefined && agentId !== lastId) {
          current = current === 'left' ? 'right' : current === 'right' ? 'left' : current
        }
        lastId = agentId
      }

      element.position = current
    }
  }

  /**
   * Attach + build lines within `radius` of the active line (plus the active set), detaching the rest.
   *
   * @returns The indexes attached this call so layout can seed their start position.
   */
  updateWindow(activeIndex: number, radius: number, activeSet: ReadonlySet<number>): number[] {
    const size = this.currentElementList.length
    if (!size) {
      return []
    }

    const lo = Math.max(0, activeIndex - radius)
    const hi = Math.min(size - 1, activeIndex + radius)

    for (const index of this.attachedSet) {
      if ((index >= lo && index <= hi) || activeSet.has(index)) {
        continue
      }
      const element = this.currentElementList[index]
      if (element) {
        element.disposeContent()
        element.element.remove()
      }
      this.attachedSet.delete(index)
    }

    const entrants: number[] = []
    const ensure = (index: number) => {
      if (this.attachedSet.has(index)) {
        return
      }
      const element = this.currentElementList[index]
      if (!element) {
        return
      }

      // Keep a newly attached shell hidden until layout seeds its transform.
      element.element.style.visibility = 'hidden'

      this.context.component.container.appendChild(element.element)
      element.buildContent()
      element.updateSize()

      this.recordHeight(element)
      this.attachedSet.add(index)
      entrants.push(index)
    }

    for (let i = lo; i <= hi; i++) {
      ensure(i)
    }
    for (const index of activeSet) {
      ensure(index)
    }

    return entrants
  }

  updateConfig(keys?: DomLyricPlayerConfig.RootKeySet) {
    if (keys && (hasKeyContaining(keys, 'layout.align') || hasKeyContaining(keys, 'layout.duet'))) {
      this.updateAlign()
    }
    for (const element of this.currentElementMap.values()) {
      element.updateConfig(keys)
    }
  }

  updateSize() {
    // Only attached lines are in the DOM and measurable; detached ones keep their cached height.
    for (const index of this.attachedSet) {
      const element = this.currentElementList[index]
      if (!element) {
        continue
      }
      element.updateSize()
      this.recordHeight(element)
    }
  }

  /**
   * Height for prefix-sum layout: the real measurement when built, otherwise an estimate (only used for off-window lines).
   */
  getHeight(element: LineElement): number {
    if (element.measured) {
      return element.height
    }
    return this.heightEstimate.get(this.heightBucket(element)) ?? FALLBACK_LINE_HEIGHT
  }

  /**
   * Smallest measured normal-line height, for sizing the window to cover the viewport.
   * Falls back to `fallback` before any normal line has been measured.
   */
  minMeasuredHeight(fallback: number): number {
    // [vendor patch] 'normal-background' 桶已随独立背景行删除。
    return this.heightEstimate.get('normal-main') ?? fallback
  }

  /**
   * Drop the estimate samples so they refill from fresh measurements after a height-affecting config change.
   */
  invalidateHeightEstimates() {
    this.heightEstimate.clear()
  }

  clear() {
    for (const element of this.currentElementMap.values()) {
      element.destroy()
    }

    this.currentElementMap.clear()
    this.currentIndexMap.clear()
    this.currentElementList = []

    this.cachedActiveLineIndexes = []
    this.cachedActiveSet = new Set()

    this.attachedSet.clear()
    this.heightEstimate.clear()
  }

  destroy() {
    this.clear()
  }
}
