import type { ComponentContext } from '../../context'

import { PlayerRole } from '../../../constants'

import { applyClassName, applyRole } from '../../../utils'

import styles from './index.module.scss'

export class Dot {
  private readonly dom: HTMLDivElement

  private animation: Animation | null = null
  private duration = 0
  private delay = 0

  constructor(
    private readonly context: ComponentContext,
    private readonly index: number
  ) {
    this.dom = document.createElement('div')
    applyClassName(this.dom, [styles.dot])
    applyRole(this.dom, PlayerRole.line.interlude.dot)
  }

  get element() {
    return this.dom
  }

  build(slice: number) {
    this.dispose()
    this.duration = slice
    this.create()
  }

  private create() {
    if (this.duration <= 0) {
      return
    }
    this.delay = this.duration * this.index

    // Fill between the configured idle and active opacities to match the resolved CSS values.
    const style = this.context.config.line.interlude.style
    this.animation = this.dom.animate(
      [{ opacity: style.normal.opacity }, { opacity: style.active.opacity }],
      {
        duration: this.duration,
        delay: this.delay,
        easing: 'linear',
        fill: 'both',
        composite: 'replace'
      }
    )
    this.animation.pause()
  }

  drive(isPlay: boolean, isActive: boolean, relativeTime: number) {
    if (!isActive) {
      const animation = this.animation
      if (!animation) {
        return
      }
      const time = animation.currentTime
      // Upcoming line, never driven: hold the idle frame and keep the animation ready.
      if (typeof time !== 'number' || time <= 0) {
        animation.pause()
        return
      }
      // Played: release opacity to CSS so the [active]-removal transition fades the dots out.
      // Reversing the WAAPI fill instead can drop a frame to the CSS value (a probabilistic flicker).
      animation.cancel()
      this.animation = null
      return
    }

    // Active: rebuild if a prior deactivation handed control back to CSS (e.g. seek back into a played interlude).
    if (!this.animation) {
      this.create()
    }
    const animation = this.animation
    if (!animation) {
      return
    }

    // `this.delay` only caches the last pushed value; recompute the base (slice * index) so it never drifts.
    const base = this.duration * this.index
    // Before the line's start (seek / before-song fallback) pad the delay so the fill does not advance during catch-up.
    const delay = base + (relativeTime < 0 ? -relativeTime : 0)
    if (this.delay !== delay) {
      this.delay = delay
      animation.effect!.updateTiming({ delay: Number.isFinite(delay) ? delay : 0 })
    }

    // Past natural end: hold the lit end via finish() (play() would auto-rewind a past-end currentTime).
    if (relativeTime >= base + this.duration) {
      if (animation.playState !== 'finished') {
        animation.finish()
      }
      return
    }

    animation.currentTime = relativeTime > 0 ? relativeTime : 0
    if (isPlay) {
      animation.play()
    } else {
      animation.pause()
    }
  }

  dispose() {
    this.animation?.cancel()
    this.animation = null
    this.duration = 0
    this.delay = 0
  }
}
