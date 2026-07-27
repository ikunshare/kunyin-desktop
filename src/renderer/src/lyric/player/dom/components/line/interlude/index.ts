import { Lyric } from '../../../../../kit/lyric'
import type { ComponentContext } from '../../context'
import type { DomLyricPlayerConfig } from '../../../config'
import type { LineElementStyle } from '../base'

import { BaseLineElement, LineElementType } from '../base'
import { Dot } from './dot'

import { PlayerRole } from '../../../constants'

import { applyClassName, applyRole } from '../../../utils'

import styles from './index.module.scss'

const DOT_COUNT = 3

export class InterludeLineElement extends BaseLineElement {
  override get type() {
    return LineElementType.Interlude as const
  }

  private container: HTMLDivElement
  private dots: Dot[]
  private animationActive = false

  constructor(
    context: ComponentContext,
    private readonly info: Lyric.Parsed.ParsedLineInterlude
  ) {
    super(context)

    this.container = document.createElement('div')
    this.element.appendChild(this.container)

    this.dots = []
    for (let i = 0; i < DOT_COUNT; i++) {
      const dot = new Dot(context, i)
      this.dots.push(dot)
      this.container.appendChild(dot.element)
    }

    this.updateConfig()
  }

  private buildClassName() {
    applyClassName(this.container, [styles.interlude])
    applyRole(this.container, PlayerRole.line.interlude.self)
  }

  private buildAnimations() {
    const raw = Lyric.Parsed.getParsedLineDuration(this.info)
    const slice = Number.isFinite(raw) ? Math.max(0, Math.floor(raw / DOT_COUNT)) : 0
    for (const dot of this.dots) {
      dot.build(slice)
    }
  }

  private updateAnimations(active: boolean) {
    if (this.animationActive === active) {
      return
    }
    this.animationActive = active
    if (active) {
      this.buildAnimations()
    } else {
      this.disposeAnimations()
    }
  }

  private driveAnimations(isPlay: boolean, isActive: boolean, relativeTime: number) {
    for (const dot of this.dots) {
      dot.drive(isPlay, isActive, relativeTime)
    }
  }

  private disposeAnimations() {
    for (const dot of this.dots) {
      dot.dispose()
    }
  }

  override updateConfig(keys?: DomLyricPlayerConfig.RootKeySet) {
    super.updateConfig(keys)

    if (!keys) {
      this.buildClassName()
    }

    if (!this.animationActive) {
      return
    }
    if (keys && !keys.has('line.interlude.style')) {
      return
    }

    this.buildAnimations()
  }

  override updateStyle(current: LineElementStyle, immediate = false) {
    super.updateStyle(current, immediate)
    this.updateAnimations(this.animatable)
  }

  override play(time: number, isActive: boolean) {
    const relativeTime = time - (Lyric.Parsed.getParsedLineTime(this.info)?.start || 0)
    this.driveAnimations(true, isActive, relativeTime)
  }

  override pause(time: number, isActive: boolean) {
    const relativeTime = time - (Lyric.Parsed.getParsedLineTime(this.info)?.start || 0)
    this.driveAnimations(false, isActive, relativeTime)
  }

  override reset(time: number) {
    const relativeTime = time - (Lyric.Parsed.getParsedLineTime(this.info)?.start || 0)
    this.driveAnimations(false, false, relativeTime)
  }

  override destroy() {
    this.disposeAnimations()
    super.destroy()
  }
}
