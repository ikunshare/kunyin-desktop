import { Lyric } from '../../../../../../../kit/lyric'
import type { ComponentContext } from '../../../../context'
import type { MaskGenerateInput } from '../animation'

import { MaskAnimation, MaskAnimationHost } from '../animation'

import { applyClassName, applyRole } from '../../../../../utils'

import styles from './index.module.scss'

export interface WordAnnotationElement {
  readonly element: HTMLElement

  /**
   * Whether the row resolved any text and should be kept.
   */
  readonly hasContent: boolean

  /**
   * Whether the row drives its own wipe (distinct timeline) instead of riding the word mask.
   */
  readonly independent: boolean

  updateSize(): void

  updateActive(active: boolean): void

  updateStyle(isPlay: boolean, isActive: boolean, currentTime: number, relativeTime: number): void

  dispose(): void
}

const isSameWindow = (a: Lyric.Common.Time | undefined, b: Lyric.Common.Time | undefined) => {
  return !!a && !!b && a.start === b.start && a.end === b.end
}

/**
 * Multiple tokens always own their timeline; a single token only when its window differs from the word.
 */
const isIndependentTimeline = (
  item: Lyric.Common.WordAnnotationRoman | Lyric.Common.WordAnnotationRuby,
  wordInfo: Lyric.Common.WordNormal
) => {
  const tokens = item.words ?? []
  if (tokens.length > 1) {
    return true
  }
  const time = tokens[0]?.time ?? item.time
  return !!time && !isSameWindow(time, wordInfo.time)
}

/**
 * Base for a per-word annotation row (romanization, ruby).
 *
 * A row whose tokens carry a distinct timeline renders as self-masked token spans and wipes on its
 * own clock; otherwise it renders as one static block that rides the word's cell mask.
 */
export abstract class WordAnnotationBaseElement implements WordAnnotationElement {
  protected readonly content: HTMLDivElement

  private readonly text: string
  private readonly ownsWipe: boolean

  // Per-token wipe state; empty when the row rides the word mask.
  private readonly spans: HTMLSpanElement[] = []
  private readonly starts: number[] = []
  private readonly durations: number[] = []

  private readonly host: MaskAnimationHost | null = null
  private readonly masks: MaskAnimation[] = []

  constructor(
    context: ComponentContext,
    wordInfo: Lyric.Common.WordNormal,
    lineInfo: Lyric.Parsed.ParsedLineContent,
    language: Lyric.LanguageTag | undefined,
    role: string,
    style: string,
    forceOwnWipe = false
  ) {
    const item = this.resolve(wordInfo, language)
    this.text = item ? Lyric.Common.getWordAnnotationText(item) : ''

    this.content = document.createElement('div')
    applyClassName(this.content, [style])
    applyRole(this.content, role)

    this.ownsWipe =
      !!item && this.text.length > 0 && (forceOwnWipe || isIndependentTimeline(item, wordInfo))

    if (!this.ownsWipe || !item) {
      this.content.innerText = this.text
      return
    }

    // Distinct timeline: render each token as its own masked span and drive a token-scoped wipe.
    const lineStart = lineInfo.time?.start ?? 0
    const fallback = item.time ?? wordInfo.time
    const fallbackStart = fallback ? fallback.start - lineStart : 0
    const fallbackDuration = Lyric.Common.getTimeDuration(fallback)
    const fragment = document.createDocumentFragment()
    for (const token of item.words) {
      if (!token.content) {
        continue
      }

      const span = document.createElement('span')
      span.classList.add(styles.token)
      span.textContent = token.content

      fragment.appendChild(span)
      this.spans.push(span)

      const time = token.time
      this.starts.push(time ? time.start - lineStart : fallbackStart)
      this.durations.push(Lyric.Common.getTimeDuration(time ?? fallback))
    }
    this.content.appendChild(fragment)

    const lineDuration = Lyric.Common.getTimeDuration(lineInfo.time)
    this.host = new MaskAnimationHost(context, lineDuration, this.spans.length)
    for (const span of this.spans) {
      this.masks.push(new MaskAnimation(span, lineDuration))
    }
  }

  /**
   * Resolve the annotation item this row renders, or `undefined` when the word has none.
   */
  protected abstract resolve(
    info: Lyric.Common.WordNormal,
    language: Lyric.LanguageTag | undefined
  ): Lyric.Common.WordAnnotationRoman | Lyric.Common.WordAnnotationRuby | undefined

  updateSize() {
    const host = this.host
    const count = this.spans.length
    if (!host || !count) {
      return
    }

    const inputs: MaskGenerateInput[] = new Array(count)
    for (let i = 0; i < count; i++) {
      const span = this.spans[i]
      inputs[i] = {
        start: this.starts[i],
        duration: this.durations[i],
        width: span.clientWidth,
        height: span.clientHeight
      }
    }

    host.generate(inputs, (index, image, size, frames) => {
      this.masks[index]?.updateInfo(image, size, frames)
    })
  }

  updateActive(active: boolean) {
    for (const mask of this.masks) {
      mask.updateActive(active)
    }
  }

  updateStyle(isPlay: boolean, isActive: boolean, currentTime: number, relativeTime: number) {
    for (const mask of this.masks) {
      mask.updateStyle(isPlay, isActive, currentTime, relativeTime)
    }
  }

  dispose() {
    for (const mask of this.masks) {
      mask.dispose()
    }
    this.masks.length = 0
    this.content.remove()
  }

  get hasContent() {
    return this.text.length > 0
  }

  get independent() {
    return this.ownsWipe
  }

  get element() {
    return this.content
  }
}
