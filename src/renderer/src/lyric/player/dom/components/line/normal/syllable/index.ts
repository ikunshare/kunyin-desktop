import type { ComponentContext } from '../../../context'
import type { DomLyricPlayerConfig } from '../../../../config'
import type { MaskGenerateInput } from './animation'

import { Lyric } from '../../../../../../kit/lyric'
import { PlayerRole } from '../../../../constants'
import { WordSlot } from '../../../../config/line/normal/syllable'
import { WordElement } from './word'
import { MaskAnimationHost } from './animation'

import { applyClassName, applyRole } from '../../../../utils'

import styles from './index.module.scss'

export class SyllableElement {
  private readonly dom: HTMLDivElement
  private readonly maskHost: MaskAnimationHost

  private words: WordElement[]

  // Mask keyframes are generated lazily on first activation.
  private maskReady = false

  constructor(
    private readonly context: ComponentContext,
    private readonly info: Lyric.Parsed.ParsedLineContent,
    private readonly isBackground: boolean
  ) {
    this.dom = document.createElement('div')

    let wordCount = 0
    for (const item of info.words) {
      if (Lyric.Common.isWordNormal(item)) {
        wordCount++
      }
    }
    this.maskHost = new MaskAnimationHost(
      context,
      Lyric.Common.getTimeDuration(info.time),
      wordCount
    )

    this.words = []

    this.updateConfig()
  }

  private updateMaskWord = (index: number, image: string, size: string, frames?: Keyframe[]) => {
    this.words[index]?.animation.mask.updateInfo(image, size, frames)
  }

  private updateMaskInfo() {
    const count = this.words.length
    if (!count) {
      return
    }

    const inputs: MaskGenerateInput[] = new Array(count)
    const lineStart = this.info.time?.start ?? 0
    const lineDuration = Lyric.Common.getTimeDuration(this.info.time)
    for (let i = 0; i < count; i++) {
      const word = this.words[i]
      const time = word.info.time!
      // [vendor patch] 词时间窗钳制到行时长内。上游假设词时间必然落在
      // [lineStart, lineStart+lineDuration]；一旦源数据损坏（如词 end 超出行 end），
      // 进度会被提前耗尽，后续词的关键帧全部堆叠到 offset=1 —— 整行擦除名存实亡。
      // 数据正常时本钳制是恒等操作。
      const start = Math.max(0, Math.min(lineDuration, time.start - lineStart))
      const end = Math.max(start, Math.min(lineDuration, time.end - lineStart))
      inputs[i] = {
        start,
        duration: end - start,
        width: word.width,
        height: word.height
      }
    }

    this.maskHost.generate(inputs, this.updateMaskWord)
  }

  private alignAnnotationRows() {
    for (const slot of [WordSlot.AnnotationRoman, WordSlot.AnnotationRuby]) {
      if (!this.words.some((word) => word.hasAnnotation(slot))) {
        continue
      }
      for (const word of this.words) {
        word.ensureAnnotationRow(slot)
      }
    }
  }

  private init() {
    this.clear()

    let isInSpace = false
    const frag = document.createDocumentFragment()
    for (const item of this.info.words) {
      if (Lyric.Common.isWordNormal(item)) {
        const node = new WordElement(this.context, item.body.value, this.info, this.isBackground)

        if (isInSpace) {
          node.element.classList.add(styles.spaceStart)
          isInSpace = false
        }

        this.words.push(node)
        frag.appendChild(node.element)
        continue
      }

      if (Lyric.Common.isWordSpace(item)) {
        const prev = this.words[this.words.length - 1]
        if (prev) {
          prev.element.classList.add(styles.spaceEnd)
        }
        isInSpace = true
      }
    }

    this.alignAnnotationRows()

    this.dom.appendChild(frag)
  }

  private clear() {
    for (const word of this.words) {
      word.dispose()
    }
    this.words = []
    this.maskReady = false
    this.dom.replaceChildren()
  }

  updateConfig(keys?: DomLyricPlayerConfig.RootKeySet) {
    if (!keys) {
      applyClassName(this.dom, [styles.syllable])
      applyRole(this.dom, PlayerRole.line.normal.text.self)
      this.init()
      return
    }

    if (this.maskReady && keys.has('line.normal.main.syllable.word.animation.mask')) {
      this.updateMaskInfo()
    }

    // Per-word changes go to each word; an annotation toggle resizes cells, so the mask regenerates on the next scheduled measure.
    // Line-roman and base language changes reach here too, since per-word annotations inherit them.
    if (
      keys.has('line.normal.main.syllable.word.animation.float') ||
      keys.has('line.normal.main.syllable.word.animation.emphasize') ||
      keys.has('line.normal.main.syllable.annotation.roman') ||
      keys.has('line.normal.main.syllable.annotation.ruby') ||
      keys.has('line.normal.main.syllable.sort') ||
      keys.has('line.normal.main.syllable.annotation.gap') ||
      keys.has('line.normal.annotation.roman.language') ||
      keys.has('line.normal.base.language')
    ) {
      for (const word of this.words) {
        word.updateConfig(keys)
      }
      if (
        keys.has('line.normal.main.syllable.annotation.roman') ||
        keys.has('line.normal.main.syllable.annotation.ruby') ||
        keys.has('line.normal.annotation.roman.language') ||
        keys.has('line.normal.base.language')
      ) {
        this.alignAnnotationRows()
      }
    }
  }

  updateSize() {
    // Measure all words, then pad each by the line's tallest upper rows so they share one baseline.
    // Alignment runs for every attached line; the mask is only regenerated once it has been built.
    let maxUpperHeight = 0
    for (const word of this.words) {
      word.updateSize()
      if (word.upperHeight > maxUpperHeight) {
        maxUpperHeight = word.upperHeight
      }
    }

    for (const word of this.words) {
      word.applyAlignment(maxUpperHeight)
    }

    if (this.maskReady) {
      this.updateMaskInfo()
    }
  }

  updateActive(active: boolean) {
    // Generate the wipe keyframes the first time the line activates (deferred from updateSize to keep entry cheap).
    if (active && !this.maskReady) {
      this.maskReady = true
      this.updateMaskInfo()
    }
    for (const word of this.words) {
      word.updateActive(active)
    }
  }

  play(currentTime: number, isActive: boolean) {
    const relativeTime = currentTime - (this.info.time?.start ?? 0)
    for (const word of this.words) {
      word.updateStyle(true, isActive, currentTime, relativeTime)
    }
  }

  pause(currentTime: number, isActive: boolean) {
    const relativeTime = currentTime - (this.info.time?.start ?? 0)
    for (const word of this.words) {
      word.updateStyle(false, isActive, currentTime, relativeTime)
    }
  }

  reset(currentTime: number) {
    const relativeTime = currentTime - (this.info.time?.start ?? 0)
    for (const word of this.words) {
      word.updateStyle(false, false, currentTime, relativeTime)
    }
  }

  dispose() {
    this.clear()
  }

  get element() {
    return this.dom
  }
}
