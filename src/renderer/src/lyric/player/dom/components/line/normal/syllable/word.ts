import { Lyric } from '../../../../../../kit/lyric'
import type { ComponentContext } from '../../../context'
import type { DomLyricPlayerConfig } from '../../../../config'
import type { WordAnnotationElement } from './annotation'

import { WORD_ANNOTATION_DESCRIPTORS } from './annotation'
import { PlayerRole } from '../../../../constants'

import { WordSlot } from '../../../../config/line/normal/syllable'
import { EmphasizeAnimation, FloatAnimation, MaskAnimation } from './animation'

import { applyClassName, applyRole, resolveWordSort } from '../../../../utils'

import styles from './index.module.scss'

export class WordElement {
  // Outer cell stacks the word-mask wipe group with any independent-timeline rows; the inner `.wipe` hosts the word mask and the word plus the rows that ride it.
  private readonly cell: HTMLDivElement
  private readonly wipe: HTMLDivElement

  private readonly word: HTMLDivElement
  private readonly size: {
    width: number
    height: number
    // Height of the upper rows from the last layout pass.
    upper: number
  }

  // Annotation rows that drive their own wipe, kept apart so the word can push size / play state to them.
  private driven: WordAnnotationElement[] = []

  private annotations: Map<WordSlot, WordAnnotationElement> = new Map()
  private annotationRows: Map<WordSlot, HTMLDivElement> = new Map()
  private chars: HTMLSpanElement[] = []

  // Annotation rows above the word; only these drive the baseline padding, so rows below the word keep no separate reference.
  private upperRows: HTMLElement[] = []

  // Latest active state, so a live annotation rebuild can re-arm its wipe for the current line.
  private active = false

  public readonly animation: {
    float: FloatAnimation
    mask: MaskAnimation
    emphasize: EmphasizeAnimation
  }

  constructor(
    private readonly context: ComponentContext,
    private readonly wordInfo: Lyric.Common.WordNormal,
    private readonly lineInfo: Lyric.Parsed.ParsedLineContent,
    private readonly isBackground: boolean
  ) {
    this.word = document.createElement('div')
    this.size = { width: 0, height: 0, upper: 0 }

    this.cell = document.createElement('div')
    this.wipe = document.createElement('div')

    this.animation = {
      // Float hosts on the word so it lifts alone.
      float: new FloatAnimation(this.word, this.context, this.wordInfo, this.lineInfo),
      // Mask hosts on the wipe so it covers the word plus the rows riding it, while independent rows mask themselves
      mask: new MaskAnimation(this.wipe, Lyric.Common.getTimeDuration(this.lineInfo.time)),
      // Emphasize only in main word.
      emphasize: new EmphasizeAnimation(
        this.context,
        this.wordInfo,
        this.lineInfo,
        this.chars,
        this.isBackground
      )
    }

    if (this.animation.emphasize.enable) {
      this.initChar()
    } else {
      this.initText()
    }

    this.updateConfig()
  }

  private initText() {
    this.chars.length = 0
    this.word.replaceChildren()
    this.cell.style.removeProperty('--emphasize-padding-horizontal')
    this.cell.style.removeProperty('--emphasize-padding-vertical')
    this.word.innerText = this.wordInfo.content
  }
  private initChar() {
    this.chars.length = 0
    this.word.replaceChildren()

    const fragment = document.createDocumentFragment()
    for (const char of this.wordInfo.content) {
      const span = document.createElement('span')
      span.textContent = char

      applyClassName(span, [styles.char])
      applyRole(span, PlayerRole.line.normal.text.word.char)

      fragment.appendChild(span)
      this.chars.push(span)
    }
    this.word.appendChild(fragment)

    // The emphasize padding lives on the cell so the inner word inherits it and the cell's negative margin cancels it.
    if (EmphasizeAnimation.PADDING_HORIZONTAL > 0) {
      this.cell.style.setProperty(
        '--emphasize-padding-horizontal',
        `${EmphasizeAnimation.PADDING_HORIZONTAL}px`
      )
    }
    if (EmphasizeAnimation.PADDING_VERTICAL > 0) {
      this.cell.style.setProperty(
        '--emphasize-padding-vertical',
        `${EmphasizeAnimation.PADDING_VERTICAL}px`
      )
    }
  }

  private createAnnotationRow() {
    const row = document.createElement('div')
    applyClassName(row, [styles.annotationRow])
    return row
  }

  private buildAnnotations() {
    this.disposeAnnotations()

    const normal = this.context.config.line.normal
    for (const descriptor of WORD_ANNOTATION_DESCRIPTORS) {
      if (!descriptor.isEnabled(normal.main.syllable)) {
        continue
      }

      // [vendor patch] 原为硬编码 true，改读配置（默认 false）：
      // 恒为 true 时逐字音译永远自走一套时钟，与主词擦除不同步。
      const element = descriptor.buildElement(
        this.context,
        this.wordInfo,
        this.lineInfo,
        descriptor.buildLanguage(normal),
        normal.main.syllable.annotation.forceOwnWipe
      )
      if (!element.hasContent) {
        element.dispose()
        continue
      }

      const row = this.createAnnotationRow()
      row.appendChild(element.element)

      this.annotations.set(descriptor.type, element)
      this.annotationRows.set(descriptor.type, row)
      if (element.independent) {
        this.driven.push(element)
      }
    }

    // A rebuild on the live line drops the old wipes, so re-arm the new ones for the current active state.
    for (const element of this.driven) {
      element.updateActive(this.active)
    }

    this.applyGap()
  }
  private disposeAnnotations() {
    for (const element of this.annotations.values()) {
      element.dispose()
    }
    this.annotations.clear()
    this.annotationRows.clear()
    this.driven = []
  }

  private applyGap() {
    if (this.annotations.size > 0) {
      // Split across both sides so two adjacent spaced words sit the configured distance apart.
      const half = this.context.config.line.normal.main.syllable.annotation.gap / 2
      this.cell.style.setProperty('--word-gap', `${half}px`)
    } else {
      this.cell.style.removeProperty('--word-gap')
    }
  }

  private applyOrder() {
    const order = resolveWordSort(this.context.config.line.normal.main.syllable.sort)
    const wordIndex = order.indexOf(WordSlot.Word)

    // [vendor patch] 跟随主词 mask 擦除的注解行（单 token 且时间窗与词一致，即 ownsWipe=false）
    // 必须放进 wipe 容器，才会被主词的擦除 mask 一并覆盖 —— 否则它们只是对齐在词上方的
    // 静态文本块，播放时毫无动画。独立 wipe 的行（多 token 连读等）仍是 cell 直接子元素，
    // 保持各自时间轴。
    const wipeAbove: HTMLElement[] = []
    const wipeBelow: HTMLElement[] = []
    const above: HTMLElement[] = []
    const below: HTMLElement[] = []
    const upper: HTMLElement[] = []

    order.forEach((slot, index) => {
      if (slot === WordSlot.Word) {
        return
      }

      const row = this.annotationRows.get(slot)
      if (!row) {
        return
      }

      // 占位空行（alignAnnotationRows 补建）没有对应 element，按 cell 布局走。
      const element = this.annotations.get(slot)
      if (element && !element.independent) {
        if (index < wordIndex) {
          wipeAbove.push(row)
          upper.push(row)
        } else {
          wipeBelow.push(row)
        }
        return
      }

      if (index < wordIndex) {
        above.push(row)
        upper.push(row)
      } else {
        below.push(row)
      }
    })

    this.wipe.replaceChildren(...wipeAbove, this.word, ...wipeBelow)
    this.cell.replaceChildren(...above, this.wipe, ...below)
    this.upperRows = upper
  }

  applyAlignment(maxUpperHeight: number) {
    const pad = maxUpperHeight - this.size.upper
    if (pad > 0) {
      this.cell.style.setProperty('--word-align-top', `${pad}px`)
    } else {
      this.cell.style.removeProperty('--word-align-top')
    }
  }

  hasAnnotation(slot: WordSlot) {
    return this.annotations.has(slot)
  }

  ensureAnnotationRow(slot: WordSlot) {
    if (this.annotationRows.has(slot)) {
      return
    }
    this.annotationRows.set(slot, this.createAnnotationRow())
    this.applyOrder()
  }

  updateStyle(isPlay: boolean, isActive: boolean, currentTime: number, relativeTime: number) {
    this.animation.float.updateStyle(isPlay, isActive, currentTime, relativeTime)
    this.animation.mask.updateStyle(isPlay, isActive, currentTime, relativeTime)
    this.animation.emphasize.updateStyle(isPlay, isActive, currentTime, relativeTime)
    for (const element of this.driven) {
      element.updateStyle(isPlay, isActive, currentTime, relativeTime)
    }
  }

  updateSize() {
    // Wipe width feeds the word's line prefix sum; the word height feeds the mask feather; the upper rows feed the baseline alignment.
    this.size.width = this.wipe.clientWidth
    this.size.height = this.word.clientHeight

    let height = 0
    for (const row of this.upperRows) {
      height += row.offsetHeight
    }
    this.size.upper = height

    // Each independent row's wipe is intra-word, so it re-measures off its own tokens with no line-level coordination.
    for (const element of this.driven) {
      element.updateSize()
    }
  }

  updateConfig(keys?: DomLyricPlayerConfig.RootKeySet) {
    if (!keys) {
      applyRole(this.cell, PlayerRole.line.normal.text.word.self)
      applyClassName(this.cell, [styles.cell])
      applyClassName(this.wipe, [styles.wipe])
      applyClassName(this.word, [styles.word])
    }

    this.animation.float.updateConfig(keys)

    const annotationsChanged =
      !keys ||
      keys.has('line.normal.main.syllable.annotation.roman') ||
      keys.has('line.normal.main.syllable.annotation.ruby') ||
      keys.has('line.normal.annotation.roman.language') ||
      keys.has('line.normal.base.language')

    if (annotationsChanged) {
      this.buildAnnotations()
    } else if (keys.has('line.normal.main.syllable.annotation.gap')) {
      this.applyGap()
    }

    if (annotationsChanged || keys.has('line.normal.main.syllable.sort')) {
      this.applyOrder()
    }

    if (keys && !keys.has('line.normal.main.syllable.word.animation.emphasize')) {
      return
    }

    const isInit = this.chars.length > 0
    const isEnable = this.animation.emphasize.enable
    if (isInit && !isEnable) {
      this.initText()
    } else if (!isInit && isEnable) {
      this.initChar()
    }

    this.animation.emphasize.updateConfig(keys)
  }

  updateActive(active: boolean) {
    this.active = active
    this.animation.float.updateActive(active)
    this.animation.mask.updateActive(active)
    this.animation.emphasize.updateActive(active)
    for (const element of this.driven) {
      element.updateActive(active)
    }
  }

  dispose() {
    this.animation.float.dispose()
    this.animation.mask.dispose()
    this.animation.emphasize.dispose()
    this.disposeAnnotations()
  }

  get height() {
    return this.size.height
  }
  get width() {
    return this.size.width
  }
  get upperHeight() {
    return this.size.upper
  }

  get info() {
    return this.wordInfo
  }

  get element() {
    return this.cell
  }
}
