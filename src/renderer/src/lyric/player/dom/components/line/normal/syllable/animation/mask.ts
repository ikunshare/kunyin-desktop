import type { ComponentContext } from '../../../../context'

export interface MaskGenerateInput {
  /**
   * Segment start, relative to the line start, in milliseconds.
   */
  start: number
  /**
   * Segment duration in milliseconds.
   */
  duration: number
  width: number
  height: number
}

const MASK_NORMAL_OPACITY = 'var(--mask-normal-opacity)'

const MASK_ACTIVE_OPACITY = 'var(--mask-active-opacity)'

export class MaskAnimationHost {
  // Segment info buffers
  private wordStartTimes!: Float64Array
  private wordDurations!: Float64Array
  private wordFrontWidths!: Float64Array

  // Progress info buffers
  private pauseProgress!: Float64Array
  private moveProgress!: Float64Array
  private hasPause!: Uint8Array
  private hasMove!: Uint8Array

  private inited = false

  constructor(
    private readonly context: ComponentContext,
    private readonly lineDuration: number,
    private readonly wordCount: number
  ) {
    this.init()
  }

  private get isEnable() {
    return this.context.config.line.normal.main.syllable.word.animation.mask.enabled
  }

  private init() {
    if (this.inited) {
      return true
    }
    if (!this.isEnable) {
      return false
    }

    const count = this.wordCount
    this.wordStartTimes = new Float64Array(count)
    this.wordDurations = new Float64Array(count)
    this.wordFrontWidths = new Float64Array(count + 1)
    this.pauseProgress = new Float64Array(count)
    this.moveProgress = new Float64Array(count)
    this.hasPause = new Uint8Array(count)
    this.hasMove = new Uint8Array(count)

    this.inited = true
    return true
  }

  generate(
    wordInfos: ReadonlyArray<MaskGenerateInput>,
    callback: (index: number, image: string, size: string, frames?: Keyframe[]) => void
  ): void {
    const wordCount = this.wordCount
    const lineDuration = this.lineDuration
    if (lineDuration <= 0 || wordCount === 0) {
      return
    }

    if (!this.isEnable) {
      for (let i = 0; i < wordCount; i++) {
        callback(i, '', '')
      }
      return
    }

    if (!this.init()) {
      return
    }

    // Feather is read on every call so config changes (auto-rebuild via SyllableElement.updateConfig) take effect immediately.
    // Values are clamped here to guard against malformed user input. Negative values would invert the cursor direction;
    // excessive values produce visually broken envelopes.
    const featherConfig = this.context.config.line.normal.main.syllable.word.animation.mask.feather
    const featherNormal = Math.max(0, Math.min(2, featherConfig.normal))
    const featherFirst = Math.max(0, Math.min(5, featherConfig.first))
    const featherLast = Math.max(0, Math.min(5, featherConfig.last))

    const invLineDuration = 1 / lineDuration
    const lastIndex = wordCount - 1

    // Layout-dependent buffers — width/height come from the latest DOM measurements,
    // so these are sized and filled fresh on every call (which only fires on layout change).
    const wordWidths = new Float64Array(wordCount)
    const wordHeights = new Float64Array(wordCount)

    const wordStartTimes = this.wordStartTimes
    const wordDurations = this.wordDurations
    // `wordFrontWidths[i]` is the prefix sum of widths over [0, i): the distance from the line's left edge to where word `i` begins.
    const wordFrontWidths = this.wordFrontWidths

    for (let i = 0; i < wordCount; i++) {
      const word = wordInfos[i]
      wordStartTimes[i] = word.start
      wordDurations[i] = word.duration
      wordWidths[i] = word.width
      wordHeights[i] = word.height
      wordFrontWidths[i + 1] = wordFrontWidths[i] + word.width
    }

    // Precompute timing-only progress: for each word, the normalized [0, 1] offsets at which its leading pause ends and at which the word finishes singing.
    // These depend solely on timing, so lifting them out of the per-word keyframe loop avoids recomputing them for each word.
    // Note: the keyframe construction below still scans all words per word, so generate() as a whole stays O(N^2).
    const pauseProgress = this.pauseProgress
    const moveProgress = this.moveProgress
    const hasPause = this.hasPause
    const hasMove = this.hasMove
    {
      let progress = 0
      let offset = 0
      for (let i = 0; i < wordCount; i++) {
        const startTime = wordStartTimes[i]
        const gap = startTime - offset
        if (gap > 0) {
          progress += gap * invLineDuration
          pauseProgress[i] = progress > 1 ? 1 : progress < 0 ? 0 : progress
          hasPause[i] = 1
        } else {
          hasPause[i] = 0
        }
        offset = startTime

        const duration = wordDurations[i]
        progress += duration * invLineDuration
        if (duration > 0) {
          moveProgress[i] = progress > 1 ? 1 : progress < 0 ? 0 : progress
          hasMove[i] = 1
        } else {
          hasMove[i] = 0
        }
        offset += duration
      }
    }

    // Per-word keyframe.
    for (let index = 0; index < wordCount; index++) {
      const wordWidth = wordWidths[index]
      if (wordWidth <= 0) {
        continue
      }

      // The fade region scales with the word's font height.
      // First and last words use an asymmetric envelope so the wipe enters and leaves the line smoothly without a visible cut at either edge.
      const widthFade = wordHeights[index] * featherNormal
      const widthFadeFirst = widthFade * featherFirst
      const widthFadeLast = widthFade * featherLast
      const widthFront = wordFrontWidths[index] + widthFade

      // Mask geometry, expressed as ratios of the word box.
      // The mask is intentionally wider than the word (`widthSize`) so sliding never exposes the gradient's hard edge.
      const widthRatio = widthFade / wordWidth
      const widthSize = 2 + widthRatio
      const widthInTotal = widthRatio / widthSize
      const leftPos = (1 - widthInTotal) / 2

      const maskImage = `linear-gradient(to right, rgba(0, 0, 0, ${MASK_ACTIVE_OPACITY}) ${leftPos * 100}%, rgba(0, 0, 0, ${MASK_NORMAL_OPACITY}) ${(leftPos + widthInTotal) * 100}%)`
      const maskSize = `${widthSize * 100}% 100%`

      // Leftmost mask position: the mask sits fully to the left of the word box, leaving the entire word unrevealed.
      const positionMin = -(wordWidth + widthFade)
      const positionMinPx = `${positionMin}px 0`

      // The cursor advances through [positionMin, 0] as the wipe progresses across the word.
      // It starts far into the negative range so the keyframe at offset 0 unambiguously represents the fully unrevealed state.
      let cursor = -widthFront - wordWidth - widthFade
      let prevCursor = cursor
      let prevProgress = 0

      // Initial keyframe at offset = 0, with the cursor clamped to [positionMin, 0].
      const initial = cursor < positionMin ? positionMin : cursor > 0 ? 0 : cursor
      const frames: Keyframe[] = [{ offset: 0, maskPosition: `${initial}px 0` }]

      for (let i = 0; i < wordCount; i++) {
        // Pause segment: the cursor stays in place and only a holding keyframe at the current offset is emitted.
        if (hasPause[i]) {
          prevProgress = pauseProgress[i]
          const clamped = cursor < positionMin ? positionMin : cursor > 0 ? 0 : cursor
          frames.push({ offset: prevProgress, maskPosition: `${clamped}px 0` })
        }

        // Advance the cursor by word i's contribution to the wipe distance.
        cursor += wordWidths[i]

        // The first word extends the leading envelope.
        if (i === 0) {
          cursor += widthFadeFirst
        }
        // The last word extends the trailing envelope.
        if (i === lastIndex) {
          cursor += widthFadeLast
        }

        if (hasMove[i]) {
          const target = moveProgress[i]
          const dt = target - prevProgress
          const dx = cursor - prevCursor

          // When the cursor crosses `positionMin` or `0` mid-segment, insert an extra keyframe at the exact crossing time.
          // Without these boundary keyframes, the inline clamp above forms a kink whose timing depends on segment length.
          // Splitting the segment at the crossing keeps the visible portion of the mask strictly linear in time.
          if (dx !== 0 && dt > 0) {
            const rate = dt / dx
            // Entering the visible range: the mask's leading edge reaches the word.
            if (prevCursor < positionMin && cursor > positionMin) {
              frames.push({
                offset: prevProgress + (positionMin - prevCursor) * rate,
                maskPosition: positionMinPx
              })
            }
            // Fully revealed: the mask's trailing edge passes the word.
            if (prevCursor < 0 && cursor > 0) {
              frames.push({
                offset: prevProgress - prevCursor * rate,
                maskPosition: '0px 0'
              })
            }
          }

          prevCursor = cursor
          prevProgress = target

          const clamped = cursor < positionMin ? positionMin : cursor > 0 ? 0 : cursor
          frames.push({ offset: target, maskPosition: `${clamped}px 0` })
        } else {
          // Zero-duration word emits no keyframe of its own, but `prevCursor` must still advance so subsequent boundary checks see the correct baseline.
          prevCursor = cursor
        }
      }

      callback(index, maskImage, maskSize, frames)
    }
  }
}

export class MaskAnimation {
  private animation: Animation | null = null
  private delay: number = 0
  private active = false

  private cachedImage = ''
  private cachedSize = ''
  private cachedFrames?: Keyframe[]

  private appliedImage = ''
  private appliedSize = ''

  constructor(
    private readonly host: HTMLElement,
    private readonly lineDuration: number
  ) {}

  private applyMaskStyle() {
    const style = this.host.style
    if (this.appliedImage !== this.cachedImage) {
      this.appliedImage = this.cachedImage
      style.maskImage = this.cachedImage
    }
    if (this.appliedSize !== this.cachedSize) {
      this.appliedSize = this.cachedSize
      style.maskSize = this.cachedSize
    }
  }

  private build() {
    this.dispose()
    if (this.cachedFrames) {
      const animation = this.host.animate(this.cachedFrames, {
        duration: this.lineDuration,
        fill: 'both'
      })
      animation.pause()
      this.animation = animation
    }
  }

  updateStyle(isPlay: boolean, isActive: boolean, currentTime: number, relativeTime: number) {
    if (!this.animation) {
      return
    }

    if (!isActive) {
      // Upcoming line (not started): hold the initial frame (fully dimmed) to match its state when it turns active.
      // Already-played line: jump to the end (fully revealed).
      // Without this, entering active would flash from fully revealed to dimmed.
      if (relativeTime <= 0) {
        this.animation.currentTime = 0
        this.animation.pause()
      } else {
        this.animation.finish()
      }
      return
    }

    const delay = relativeTime < 0 ? -relativeTime : 0
    if (this.delay !== delay) {
      this.delay = delay
      this.animation.effect!.updateTiming({ delay })
    }

    // Past effect end: use `.finish()` instead of `.play()` to avoid WAAPI's auto-rewind for animations whose `currentTime` lies past the effect end.
    if (relativeTime >= this.lineDuration) {
      if (this.animation.playState !== 'finished') {
        this.animation.finish()
      }
      return
    }

    this.animation.playbackRate = 1
    this.animation.currentTime = relativeTime < 0 ? 0 : relativeTime
    if (isPlay) {
      this.animation.play()
    } else {
      this.animation.pause()
    }
  }

  updateInfo(image: string, size: string, frames?: Keyframe[]) {
    this.cachedImage = image
    this.cachedSize = size
    this.cachedFrames = frames

    // Active words rebuild immediately; off-window ones refresh their static mask on the next updateStyle.
    if (this.active) {
      this.applyMaskStyle()
      this.build()
    }
  }

  updateActive(active: boolean) {
    if (this.active === active) {
      return
    }
    if (active) {
      this.active = true
      this.applyMaskStyle()
      this.build()
    } else {
      this.active = false
      this.dispose()
    }
  }

  dispose() {
    this.animation?.cancel()
    this.animation = null
    this.delay = 0
  }
}
