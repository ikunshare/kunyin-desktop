import { Lyric } from '../../../../../../../kit/lyric'
import type { ComponentContext } from '../../../../context'
import type { DomLyricPlayerConfig } from '../../../../../config'

export class FloatAnimation {
  private animation: Animation | null = null
  private duration: number = 0
  private delay: number = 0
  private active = false

  constructor(
    private readonly host: HTMLDivElement,
    private readonly context: ComponentContext,
    private readonly wordInfo: Lyric.Common.WordNormal,
    private readonly lineInfo: Lyric.Parsed.ParsedLineContent
  ) {}

  // Built lazily on activate so off-window words don't hold a compositor layer.
  private build() {
    this.dispose()

    const config = this.context.config.line.normal.main.syllable.word.animation.float
    if (!config.enabled) {
      return
    }

    // Guard against a non-finite lyric duration so WAAPI timing stays valid.
    const rawDuration = Lyric.Common.getWordDuration(this.wordInfo)
    const duration = Number.isFinite(rawDuration) ? Math.max(1000, rawDuration) : 1000
    this.duration = duration

    const delay = this.wordInfo.time!.start - (this.lineInfo.time?.start ?? 0)
    this.delay = delay

    this.animation = this.host.animate(
      [
        { transform: `translateY(${config.from ?? 0}px)` },
        { transform: `translateY(${config.to ?? 2}px)` }
      ],
      {
        delay,
        duration,
        fill: 'both',
        composite: 'add',
        easing: 'ease'
      }
    )
    this.animation.pause()
  }

  updateStyle(isPlay: boolean, isActive: boolean, currentTime: number, relativeTime: number) {
    if (!this.animation) {
      return
    }

    if (!isActive) {
      // Just built for an upcoming line and never driven yet: keep it paused at the initial frame.
      // Reversing now would auto-rewind to the effect end (playbackRate < 0 at currentTime 0) and float back once.
      const time = this.animation.currentTime
      if (typeof time !== 'number' || time <= 0) {
        this.animation.pause()
        return
      }
      if (this.animation.playbackRate !== -1) {
        this.animation.playbackRate = -1
        this.animation.play()
      }
      return
    }

    // When the line is active but `currentTime` is still before its start (e.g. before-song fallback / seek)
    // pad the effect's delay so the float does not advance during the catch-up window.
    const initDelay = this.wordInfo.time!.start - (this.lineInfo.time?.start ?? 0)
    const delay = relativeTime < 0 ? initDelay - relativeTime : initDelay
    if (this.delay !== delay) {
      this.delay = delay
      this.animation.effect!.updateTiming({ delay })
    }

    // Past effect end: use `.finish()` instead of `.play()` to avoid WAAPI's auto-rewind for animations whose `currentTime` lies past the effect end.
    if (relativeTime >= initDelay + this.duration) {
      if (this.animation.playState !== 'finished') {
        this.animation.finish()
      }
      return
    }

    this.animation.playbackRate = 1
    this.animation.currentTime = relativeTime > 0 ? relativeTime : 0
    if (isPlay) {
      this.animation.play()
    } else {
      this.animation.pause()
    }
  }

  updateActive(active: boolean) {
    if (this.active === active) {
      return
    }
    if (active) {
      this.active = true
      this.build()
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
    if (keys && !keys.has('line.normal.main.syllable.word.animation.float')) {
      return
    }
    this.build()
  }

  dispose() {
    this.animation?.cancel()
    this.animation = null
    this.duration = 0
    this.delay = 0
  }
}
