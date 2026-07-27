import { Lyric } from '../../../../../../../kit/lyric'
import type { ComponentContext } from '../../../../context'
import type { DomLyricPlayerConfig } from '../../../../../config'

import { clamp, parseColor, round } from '../../../../../utils'

abstract class EffectBase {
  /** Per-character WAAPI animations created by `init` and driven by `drive`. */
  protected animations: Animation[] = []

  // Animation duration in ms for single character.
  protected duration = 0
  // Line-relative ms at which the first character's animation starts.
  protected delay = 0
  // Per-character delay increment within the word.
  protected stagger = 0
  // ms subtracted from every character's delay (float lead-in; 0 for others).
  protected leading = 0

  private currentDelays: number[] = []

  constructor(
    protected readonly context: ComponentContext,
    protected readonly chars: HTMLSpanElement[]
  ) {}

  protected reset(duration: number, delay: number, stagger: number, leading: number = 0) {
    this.duration = duration
    this.delay = delay
    this.stagger = stagger
    this.leading = leading
    this.currentDelays = []
  }

  abstract get enabled(): boolean

  updateDelay(value: number) {
    const count = this.animations.length
    if (!count) {
      return
    }

    const delay = this.delay
    const stagger = this.stagger
    const leading = this.leading
    for (let i = 0; i < count; i++) {
      const target = delay + stagger * i - leading + value
      if (this.currentDelays[i] === target) {
        continue
      }
      this.currentDelays[i] = target
      this.animations[i].effect!.updateTiming({
        delay: Number.isFinite(target) ? target : 0
      })
    }
  }

  drive(
    isPlay: boolean,
    isActive: boolean,
    relativeTime: number,
    localTime: number,
    disableRate: number
  ) {
    const animations = this.animations
    const count = animations.length
    if (!count) {
      return
    }

    // Line-switch wind-down: fast-forward any in-flight animation via `playbackRate` so the residual peak collapses quickly.
    // `currentTime` is left untouched so we don't trigger WAAPI's auto-rewind by putting the effect in 'after' phase before play().
    if (!isActive) {
      for (let i = 0; i < count; i++) {
        const animation = animations[i]
        if (animation.playState === 'finished') {
          continue
        }
        // Just built for an upcoming line and never driven yet: keep it paused at the initial frame.
        // Fast-forwarding here would flash the emphasis once before the line is even reached.
        const time = animation.currentTime
        if (typeof time !== 'number' || time <= 0) {
          animation.pause()
          continue
        }
        if (animation.playbackRate !== disableRate) {
          animation.playbackRate = disableRate
        }
        animation.play()
      }
      return
    }

    const delay = this.delay
    const stagger = this.stagger
    const duration = this.duration
    const leading = this.leading

    for (let i = 0; i < count; i++) {
      const animation = animations[i]
      const end = delay + stagger * i - leading + duration
      // Past natural end:
      // Use `.finish()` instead of `.play()` to avoid WAAPI's auto-rewind for animations whose `currentTime` lies past the effect end.
      if (relativeTime >= end) {
        if (animation.playState !== 'finished') {
          animation.finish()
        }
        continue
      }
      animation.playbackRate = 1
      animation.currentTime = localTime
      if (isPlay) {
        animation.play()
      } else {
        animation.pause()
      }
    }
  }

  dispose() {
    for (let i = 0; i < this.animations.length; i++) {
      this.animations[i].cancel()
    }
    this.animations = []
    this.duration = 0
    this.delay = 0
    this.stagger = 0
    this.leading = 0
  }
}

class MainEffect extends EffectBase {
  private get config() {
    return this.context.config.line.normal.main.syllable.word.animation.emphasize.effects.main
  }

  override get enabled() {
    return this.config.enabled
  }

  init(intensity: number, duration: number, delay: number, stagger: number) {
    this.dispose()

    if (!this.enabled) {
      return
    }

    const chars = this.chars
    const count = chars.length
    if (!count) {
      return
    }

    const config = this.config
    this.reset(duration, delay, stagger)

    const riseEasing = config.easingRise

    const peakEasing = config.easingFall
    const peakScale = round(1 + config.scale * intensity, 3)

    const offsetX = round(config.offsetHorizontal * intensity, 3)
    const offsetY = round(-config.offsetVertical * intensity, 3)

    const animations = this.animations
    for (let i = 0; i < count; i++) {
      const offset = count / 2 - i
      const value = delay + stagger * i
      // 3D transforms (scale3d / translate3d) promote each character to a GPU layer so the scale plays on the compositor without edge shimmer.
      const animation = chars[i].animate(
        [
          {
            offset: 0,
            transform: 'scale3d(1, 1, 1) translate3d(0px, 0px, 0px)',
            easing: riseEasing
          },
          {
            offset: 0.5,
            transform: `scale3d(${peakScale}, ${peakScale}, 1) translate3d(${round(-offsetX * offset, 3)}px, ${offsetY}px, 0px)`,
            easing: peakEasing
          },
          { offset: 1, transform: 'scale3d(1, 1, 1) translate3d(0px, 0px, 0px)' }
        ],
        {
          duration: duration,
          delay: Number.isFinite(value) ? value : 0,
          fill: 'both',
          composite: 'replace'
        }
      )
      animation.pause()
      animations.push(animation)
    }
  }
}

class GlowEffect extends EffectBase {
  private get config() {
    return this.context.config.line.normal.main.syllable.word.animation.emphasize.effects.glow
  }

  override get enabled() {
    return this.config.enabled
  }

  init(intensity: number, duration: number, delay: number, stagger: number) {
    this.dispose()

    if (!this.enabled) {
      return
    }

    const chars = this.chars
    const count = chars.length
    if (!count) {
      return
    }

    const config = this.config
    const color = parseColor(config.color)
    if (!color) {
      return
    }

    this.reset(duration, delay, stagger)

    const radius = round(Math.min(config.maxRadius, intensity * config.maxRadius), 3)
    const alpha = round(clamp(intensity * config.maxAlpha, 0, 1), 3)
    const reset = `0 0 ${radius}px rgba(${color[0]}, ${color[1]}, ${color[2]}, 0)`
    const peak = `0 0 ${radius}px rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha})`

    const animations = this.animations
    for (let i = 0; i < count; i++) {
      const value = delay + stagger * i
      const animation = chars[i].animate(
        [
          { offset: 0, textShadow: reset, easing: config.easingRise },
          { offset: 0.5, textShadow: peak, easing: config.easingFall },
          { offset: 1, textShadow: reset }
        ],
        {
          duration: duration,
          delay: Number.isFinite(value) ? value : 0,
          fill: 'both',
          composite: 'replace'
        }
      )
      animation.pause()
      animations.push(animation)
    }
  }
}

class FloatEffect extends EffectBase {
  private get config() {
    return this.context.config.line.normal.main.syllable.word.animation.emphasize.effects.float
  }

  override get enabled() {
    return this.config.enabled
  }

  init(baseDuration: number, delay: number, stagger: number, isBackground: boolean) {
    this.dispose()

    if (!this.enabled) {
      return
    }

    const chars = this.chars
    const count = chars.length
    if (!count) {
      return
    }

    const config = this.config

    const durationScale = config.duration.scale
    const duration = Number.isFinite(baseDuration * durationScale)
      ? baseDuration * durationScale
      : 0
    const leading = config.duration.lead
    this.reset(duration, delay, stagger, leading)

    const easing = config.easing
    const background = config.background
    const amplitudeScale = isBackground && background.enabled ? background.scale : 1
    const peakTransform = `translateY(${round(-config.amplitude * amplitudeScale, 3)}px)`

    const animations = this.animations
    for (let i = 0; i < count; i++) {
      const value = delay + stagger * i - leading
      const animation = chars[i].animate(
        [
          { offset: 0, transform: 'translateY(0px)', easing: easing },
          { offset: 0.5, transform: peakTransform, easing: easing },
          { offset: 1, transform: 'translateY(0px)' }
        ],
        {
          duration,
          delay: Number.isFinite(value) ? value : 0,
          fill: 'both',
          composite: 'add'
        }
      )
      animation.pause()
      animations.push(animation)
    }
  }
}

export class EmphasizeAnimation {
  static PADDING_HORIZONTAL = 9
  static PADDING_VERTICAL = 5

  private readonly main: MainEffect
  private readonly glow: GlowEffect
  private readonly float: FloatEffect

  private inited = false
  private active = false

  private get config() {
    return this.context.config.line.normal.main.syllable.word.animation.emphasize
  }

  constructor(
    private readonly context: ComponentContext,
    private readonly wordInfo: Lyric.Common.WordNormal,
    private readonly lineInfo: Lyric.Parsed.ParsedLineContent,
    private readonly chars: HTMLSpanElement[],
    private readonly isBackground: boolean
  ) {
    this.main = new MainEffect(context, chars)
    this.glow = new GlowEffect(context, chars)
    this.float = new FloatEffect(context, chars)
  }

  get enable() {
    if (!this.config.enabled) {
      return false
    }
    if (!this.wordInfo.stress || !this.wordInfo.content) {
      return false
    }
    const effects = this.config.effects
    if (!effects.main.enabled && !effects.glow.enabled && !effects.float.enabled) {
      return false
    }
    return true
  }

  private get visible() {
    return this.enable && this.chars.length > 0
  }

  private get params() {
    // Short syllables get a much softer treatment (cubic); long ones less than linear (sqrt).
    const min = Math.max(0, this.config.minDuration)
    const raw = Math.max(min, Lyric.Common.getWordDuration(this.wordInfo))

    let mainIntensity = raw / 2000
    mainIntensity = mainIntensity > 1 ? Math.sqrt(mainIntensity) : mainIntensity ** 3
    mainIntensity = clamp(mainIntensity * 0.6, 0, 1.2)

    let glowIntensity = raw / 3000
    glowIntensity = glowIntensity > 1 ? Math.sqrt(glowIntensity) : glowIntensity ** 3
    glowIntensity = clamp(glowIntensity * 0.5, 0, 0.8)

    const duration = Number.isFinite(raw) ? raw : 0
    const delay = this.wordInfo.time!.start - (this.lineInfo.time?.start ?? 0)
    const stagger = duration / 2.5 / this.chars.length

    return { mainIntensity, glowIntensity, duration, delay, stagger }
  }

  private init() {
    this.dispose()

    if (!this.visible) {
      return
    }

    const params = this.params
    this.main.init(params.mainIntensity, params.duration, params.delay, params.stagger)
    this.glow.init(params.glowIntensity, params.duration, params.delay, params.stagger)
    this.float.init(params.duration, params.delay, params.stagger, this.isBackground)

    this.inited = true
  }

  updateStyle(isPlay: boolean, isActive: boolean, currentTime: number, relativeTime: number) {
    if (!this.inited) {
      return
    }

    const adjustment = relativeTime < 0 ? -relativeTime : 0
    this.main.updateDelay(adjustment)
    this.glow.updateDelay(adjustment)
    this.float.updateDelay(adjustment)

    const localTime = relativeTime > 0 ? relativeTime : 0
    // Clamp to the documented @min 1; 0 or negative would stall or reverse the wind-down.
    const disableRate = Math.max(1, this.config.disablePlaybackRate)

    this.main.drive(isPlay, isActive, relativeTime, localTime, disableRate)
    this.glow.drive(isPlay, isActive, relativeTime, localTime, disableRate)
    this.float.drive(isPlay, isActive, relativeTime, localTime, disableRate)
  }

  updateActive(active: boolean) {
    if (this.active === active) {
      return
    }
    if (active) {
      this.active = true
      this.init()
    } else {
      this.active = false
      this.dispose()
    }
  }

  updateConfig(keys?: DomLyricPlayerConfig.RootKeySet) {
    // Lazy: a deactivated animation never rebuilds here; a later activate() picks up the new config.
    if (!this.active) {
      return
    }

    // Not emphasize changes, nothing to do.
    if (keys && !keys.has('line.normal.main.syllable.word.animation.emphasize')) {
      return
    }

    if (
      !keys ||
      this.inited !== this.visible ||
      keys.has('line.normal.main.syllable.word.animation.emphasize.enabled') ||
      keys.has('line.normal.main.syllable.word.animation.emphasize.minDuration')
    ) {
      this.init()
      return
    }

    if (!this.visible) {
      return
    }

    const params = this.params
    if (keys.has('line.normal.main.syllable.word.animation.emphasize.effects.main')) {
      this.main.init(params.mainIntensity, params.duration, params.delay, params.stagger)
    }
    if (keys.has('line.normal.main.syllable.word.animation.emphasize.effects.glow')) {
      this.glow.init(params.glowIntensity, params.duration, params.delay, params.stagger)
    }
    if (keys.has('line.normal.main.syllable.word.animation.emphasize.effects.float')) {
      this.float.init(params.duration, params.delay, params.stagger, this.isBackground)
    }
  }

  dispose() {
    this.main.dispose()
    this.glow.dispose()
    this.float.dispose()
    this.inited = false
  }
}
