import type { ComponentContext } from '../../context'
import type { LineElementStyle } from '../base'
import type { AnnotationBaseElement } from './annotation'

import { Lyric } from '../../../../../kit/lyric'
import { PlayerRole } from '../../../constants'
import { DomLyricPlayerConfig } from '../../../config'

import { BaseLineElement, LineElementType } from '../base'
import { SyllableElement } from './syllable'
import { PlainElement } from './plain'
import { ANNOTATION_DESCRIPTORS } from './annotation'

import { applyClassName, applyRole, resolveSort } from '../../../utils'

import styles from './index.module.scss'

export class NormalLineElement extends BaseLineElement {
  override get type() {
    return LineElementType.Normal as const
  }

  // [vendor patch] 收窄为 ParsedLineNormal：背景人声不再建独立行，改由本行渲染行内子行（见 buildBackgrounds）。
  private readonly content: Lyric.Parsed.ParsedLineNormal

  private container: HTMLDivElement
  private main: SyllableElement | PlainElement | null = null
  private backgrounds: (SyllableElement | PlainElement)[] = []
  private annotations: Map<DomLyricPlayerConfig.Line.Normal.LineSlot, AnnotationBaseElement> =
    new Map()

  private readonly syllableEnable: boolean

  constructor(context: ComponentContext, info: Lyric.Parsed.ParsedLineNormal, isSyllable: boolean) {
    super(context)

    this.content = info
    this.syllableEnable = isSyllable

    this.container = document.createElement('div')
    applyRole(this.container, PlayerRole.line.normal.self)
    this.element.appendChild(this.container)

    // Heavy content (main + backgrounds + annotations) is built lazily by the content window via buildContent().
    this.contentBuilt = false

    this.updateConfig()
  }

  private applyClassName() {
    applyClassName(this.container, [styles.normal])
  }

  // Syllable rendering needs both the lyric's syllable timing and the configured mode; otherwise fall back to plain text.
  private get useSyllable() {
    return this.syllableEnable && this.context.config.line.normal.main.use === 'syllable'
  }

  private get usePerWordRoman() {
    if (
      !this.useSyllable ||
      !this.context.config.line.normal.main.syllable.annotation.roman.visible
    ) {
      return false
    }
    for (const word of this.content.words) {
      if (
        Lyric.Common.isWordNormal(word) &&
        (word.body.value.annotation?.romans?.[0]?.words.length ?? 0) > 0
      ) {
        return true
      }
    }
    return false
  }

  private createMain() {
    return this.useSyllable
      ? new SyllableElement(this.context, this.content, false)
      : new PlainElement(this.content)
  }
  private buildMain() {
    this.disposeMain()
    this.main = this.createMain()
  }
  private disposeMain() {
    // dispose only tears down internal state, so detach the node here to keep it out of the container before a rebuild.
    const previous = this.main?.element
    this.main?.dispose()
    this.main = null
    previous?.remove()
  }

  // [vendor patch] 背景人声渲染为主行内的子行（主词下方、注解上方），常显小字。
  // 上游方案是每个 background 建一个独立行 element，激活时才浮现并推挤后续行（整页跳动），
  // 还会把主行翻译/音译复制一份小字注解，小屏直接折成一团。
  // 行内子行复用 SyllableElement 全套逐字动画，且以背景 content 自己的时间轴驱动——
  // 主唱与和声并行擦除（和声词往往与主词时间交叠，接回主词末尾排队是错的）。
  private createBackground(content: Lyric.Parsed.ParsedLineBackground) {
    return this.useSyllable
      ? new SyllableElement(this.context, content, true)
      : new PlainElement(content)
  }
  private buildBackgrounds() {
    this.disposeBackgrounds()
    for (const bg of this.content.backgrounds ?? []) {
      if (!bg.words?.length) continue
      const element = this.createBackground(bg)
      element.element.classList.add(styles.backgroundRow)
      this.backgrounds.push(element)
    }
  }
  private disposeBackgrounds() {
    for (const element of this.backgrounds) {
      element.dispose()
      element.element.remove()
    }
    this.backgrounds = []
  }

  private get needShowAnnotation() {
    return this.context.config.line.normal.annotation.visible
  }
  private buildAnnotations() {
    this.disposeAnnotations()
    if (!this.needShowAnnotation) {
      return
    }
    const usePerWordRoman = this.usePerWordRoman
    const normal = this.context.config.line.normal
    for (const descriptor of ANNOTATION_DESCRIPTORS) {
      // The line-level roman row yields its slot to per-word romanization when that is active.
      if (
        descriptor.slot === DomLyricPlayerConfig.Line.Normal.LineSlot.AnnotationRoman &&
        usePerWordRoman
      ) {
        continue
      }
      if (!descriptor.isEnabled(normal.annotation)) {
        continue
      }
      const element = descriptor.create(this.content, descriptor.language(normal))
      // A line that simply has no such annotation contributes no row at all.
      if (!element.hasContent) {
        element.dispose()
        continue
      }
      this.annotations.set(descriptor.slot, element)
    }
  }
  private disposeAnnotations() {
    for (const element of this.annotations.values()) {
      element.dispose()
    }
    this.annotations.clear()
  }

  private resolveSlotElement(slot: DomLyricPlayerConfig.Line.Normal.LineSlot): HTMLElement | null {
    if (slot === DomLyricPlayerConfig.Line.Normal.LineSlot.Main) {
      return this.main?.element ?? null
    }
    return this.annotations.get(slot)?.element ?? null
  }

  // Re-append every present row in the configured order; `appendChild` moves existing nodes, so reordering never rebuilds them.
  private applyOrder() {
    for (const slot of resolveSort(this.context.config.line.normal.sort)) {
      const element = this.resolveSlotElement(slot)
      if (element) {
        this.container.appendChild(element)
      }
    }
    // [vendor patch] 背景子行始终紧随主词行（无论 sort 里 Main 槽位排第几）；
    // 主词槽位缺席时退到容器最前，语义上仍贴近主词。
    if (this.backgrounds.length) {
      const mainElement = this.main?.element ?? null
      let anchor: HTMLElement | null =
        mainElement && mainElement.parentNode === this.container ? mainElement : null
      for (const bg of this.backgrounds) {
        this.container.insertBefore(
          bg.element,
          anchor ? anchor.nextSibling : this.container.firstChild
        )
        anchor = bg.element
      }
    }
  }

  override updateConfig(keys?: DomLyricPlayerConfig.RootKeySet): void {
    super.updateConfig(keys)

    if (!keys) {
      this.applyClassName()
      return
    }

    // Released lines carry no content; they rebuild fresh from the current config on the next buildContent().
    if (!this.built) {
      return
    }

    const syllableToggled = keys.has('line.normal.main.use')
    if (syllableToggled) {
      this.buildMain()
      this.buildBackgrounds()
    }

    const romanChanged = keys.has('line.normal.main.syllable.annotation.roman')
    const annotationChanged =
      keys.has('line.normal.annotation.visible') ||
      keys.has('line.normal.annotation.translate') ||
      keys.has('line.normal.annotation.roman') ||
      keys.has('line.normal.base.language')

    // The line-level roman slot tracks the per-word-roman verdict, which shifts with the main mode and the per-word roman config.
    if (annotationChanged || syllableToggled || romanChanged) {
      this.buildAnnotations()
    }

    // Reorder whenever a slot was rebuilt or the sort itself changed.
    if (syllableToggled || annotationChanged || romanChanged || keys.has('line.normal.sort')) {
      this.applyOrder()
    }

    this.main?.updateConfig(keys)
    for (const bg of this.backgrounds) {
      bg.updateConfig(keys)
    }
  }

  override buildContent(): void {
    if (this.built) {
      return
    }
    this.contentBuilt = true

    this.buildMain()
    this.buildBackgrounds()
    this.buildAnnotations()
    this.applyOrder()
  }

  override disposeContent(): void {
    if (!this.built) {
      return
    }
    // Keep the cached height (the absolute wrapper just goes empty) so layout positioning stays exact.
    this.disposeMain()
    this.disposeBackgrounds()
    this.disposeAnnotations()
    this.contentBuilt = false
  }

  override updateSize(): void {
    super.updateSize()
    this.main?.updateSize()
    for (const bg of this.backgrounds) {
      bg.updateSize()
    }
  }

  override play(time: number, isActive: boolean) {
    this.main?.play(time, isActive)
    for (const bg of this.backgrounds) {
      bg.play(time, isActive)
    }
  }

  override pause(time: number, isActive: boolean) {
    this.main?.pause(time, isActive)
    for (const bg of this.backgrounds) {
      bg.pause(time, isActive)
    }
  }

  override reset(time: number) {
    this.main?.reset(time)
    for (const bg of this.backgrounds) {
      bg.reset(time)
    }
  }

  override updateStyle(current: LineElementStyle, immediate = false) {
    super.updateStyle(current, immediate)
    this.main?.updateActive(this.animatable)
    for (const bg of this.backgrounds) {
      bg.updateActive(this.animatable)
    }
  }

  override destroy() {
    this.disposeMain()
    this.disposeBackgrounds()
    this.disposeAnnotations()
    super.destroy()
  }

  get info() {
    return this.content
  }
}
