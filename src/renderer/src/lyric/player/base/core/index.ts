import type { BaseLyricPlayerEventMap } from '../interface'

import { Lyric } from '../../../kit/lyric'
import { ConfigManager, Event } from '../../utils'
import { BaseLyricPlayerConfig } from '../config'

import { Merger } from './merger'
import { Offset } from './offset'
import { Driver } from './driver'

import { satisfies } from 'semver'

// Parse results must satisfy this caret range of the supported lyric format version, else they are rejected.
const SUPPORTED_VERSION_RANGE = `^${Lyric.SCHEMA_VERSION}`

export class BaseLyricPlayer {
  readonly config: BaseLyricPlayerConfig.RootManager = new ConfigManager(
    BaseLyricPlayerConfig.DEFAULT as BaseLyricPlayerConfig.RootRequired
  )

  readonly event: Event<BaseLyricPlayerEventMap> = new Event()

  private state: {
    playing: boolean
    scanIndex: number
  }
  private active: {
    lines: Lyric.Parsed.ParsedLine[]
    index: number[]
  }
  private time: {
    start: number
    seek: number
  }
  private info: Lyric.Parsed.Info

  private merger: Merger = new Merger()
  private offset: Offset = new Offset()
  private driver: Driver = new Driver()

  constructor() {
    this.state = {
      playing: false,
      scanIndex: 0
    }
    this.active = {
      lines: [],
      index: []
    }
    this.time = {
      start: 0,
      seek: 0
    }
    this.info = Lyric.Parsed.makeParsedInfo()

    this.config.event.add('update', this.onConfigUpdate)
  }

  private onConfigUpdate = (keys: BaseLyricPlayerConfig.RootKeySet) => {
    // Toggling meta usage re-derives the lyric offset from the current info.
    const metaToggled = keys.has('offset.useMeta')
    if (metaToggled) {
      this.offset.refreshFromMeta(this.info, this.config.current.offset.useMeta)
    }
    // Offset changed = time shift, re-match active lines against the new effective time.
    if (metaToggled || keys.has('offset.global')) {
      this.handleSyncTime()
    }
    // Merge settings changed: rebuild merged ends and re-match active lines.
    if (keys.has('mergeWindow') || keys.has('mergeLimit')) {
      this.handleBuildMergedLineEnd()
      this.handleSyncTime()
    }
  }

  // Get current playback time.
  private handleGetCurrentTime() {
    if (!this.state.playing) {
      return this.time.seek
    }
    return this.time.seek + (performance.now() - this.time.start)
  }

  // Real playback time shifted by the combined offset; all lyric matching runs against this.
  private handleGetEffectiveTime() {
    return this.handleGetCurrentTime() + this.currentOffset
  }

  /**
   * Rebuild the merged line-end table from the current lyric and merge config.
   */
  private handleBuildMergedLineEnd() {
    this.merger.build(
      this.info.lines,
      this.config.current.mergeWindow,
      this.config.current.mergeLimit
    )
  }

  private handleGetActiveIndex() {
    return this.active.index.length > 0 ? this.active.index[0] : -1
  }

  private handleBridgeActive(
    lines: Lyric.Parsed.ParsedLine[],
    index: number[]
  ): { lines: Lyric.Parsed.ParsedLine[]; index: number[] } {
    if (!this.config.current.bridgeActive || index.length < 2) {
      return { lines, index }
    }
    const min = index[0]
    const max = index[index.length - 1]
    if (max - min + 1 === index.length) {
      return { lines, index }
    }
    const existing = new Map<number, Lyric.Parsed.ParsedLine>()
    for (let i = 0; i < index.length; i++) {
      existing.set(index[i], lines[i])
    }
    const bridgedLines: Lyric.Parsed.ParsedLine[] = []
    const bridgedIndex: number[] = []
    for (let i = min; i <= max; i++) {
      const line = existing.get(i) ?? this.info.lines[i]
      if (!line) continue
      bridgedLines.push(line)
      bridgedIndex.push(i)
    }
    return { lines: bridgedLines, index: bridgedIndex }
  }

  private handleEmitLinesUpdate(isSeek: boolean) {
    const bridged = this.handleBridgeActive(this.active.lines, this.active.index)
    this.event.emit(
      'linesUpdate',
      bridged.lines,
      bridged.index,
      this.handleGetActiveIndex(),
      isSeek
    )
  }

  private handleSyncTime(time?: number) {
    if (!this.info.lines.length) {
      return
    }

    if (time === undefined) {
      time = this.handleGetEffectiveTime()
    }

    if (!Number.isFinite(time)) {
      return
    }

    const lines: Lyric.Parsed.ParsedLine[] = []
    const index: number[] = []

    let firstIndex = this.info.lines.length
    for (let i = 0; i < this.info.lines.length; i++) {
      const line = this.info.lines[i]
      // Lines are assumed sorted by time.start ascending, so the first line starting after `time` ends the scan.
      if (Lyric.Parsed.getParsedLineTime(line)!.start > time) {
        firstIndex = i
        break
      }

      if (this.merger.getMergedTime(i) > time) {
        lines.push(line)
        index.push(i)
      }
    }

    this.state.scanIndex = firstIndex

    this.active.lines = lines
    this.active.index = index

    this.handleEmitLinesUpdate(true)
  }

  private handleUpdateActiveLines(now: number) {
    let hasChanged = false

    const newActiveLines: Lyric.Parsed.ParsedLine[] = []
    const newActiveIndex: number[] = []

    for (let i = 0; i < this.active.lines.length; i++) {
      const line = this.active.lines[i]
      const infoIndex = this.active.index[i]

      if (now >= this.merger.getMergedTime(infoIndex)) {
        hasChanged = true
      } else {
        newActiveLines.push(line)
        newActiveIndex.push(infoIndex)
      }
    }

    while (this.state.scanIndex < this.info.lines.length) {
      const nextLine = this.info.lines[this.state.scanIndex]
      const nextTime = Lyric.Parsed.getParsedLineTime(nextLine)
      if (now >= nextTime!.start) {
        if (now < this.merger.getMergedTime(this.state.scanIndex)) {
          newActiveLines.push(nextLine)
          newActiveIndex.push(this.state.scanIndex)
          hasChanged = true
        }
        this.state.scanIndex++
      } else {
        break
      }
    }

    if (!hasChanged) {
      return
    }

    this.active.lines = newActiveLines
    this.active.index = newActiveIndex
    this.handleEmitLinesUpdate(false)
  }

  private onTick = () => {
    if (!this.state.playing) {
      return
    }

    const now = this.handleGetEffectiveTime()
    this.handleUpdateActiveLines(now)

    this.driver.schedule(this.config.current.driver, this.onTick)
  }

  updateLyric(info: Lyric.Parsed.Info) {
    if (!info) {
      return
    }

    // Reject parse results whose lyric format version is incompatible, clearing any current lyric.
    let target = info
    if (!satisfies(info.version, SUPPORTED_VERSION_RANGE)) {
      console.warn(
        `[music-lyric-player] ignored lyric with incompatible version "${info.version}", expected "${SUPPORTED_VERSION_RANGE}"`
      )
      target = Lyric.Parsed.makeParsedInfo()
    }

    this.pause()
    this.info = target
    this.handleBuildMergedLineEnd()

    this.offset.refreshFromMeta(this.info, this.config.current.offset.useMeta)
    if (this.config.current.offset.resetTempOnLyricChange) {
      this.offset.resetTemp()
    }

    this.active.lines = []
    this.active.index = []

    this.state.scanIndex = 0
    this.time.seek = 0

    this.event.emit('lyricUpdate', target)
    this.event.emit('linesUpdate', [], [], -1, false)
  }

  /**
   * Start playback
   *
   * @param time Optional time in ms to seek to before starting playback. If not provided, playback will start from the current position.
   */
  play(time?: number) {
    this.pause()

    if (typeof time === 'number' && Number.isFinite(time)) {
      this.time.seek = time
      this.handleSyncTime()
    }

    this.time.start = performance.now()
    this.state.playing = true
    this.onTick()

    this.event.emit('play', this.handleGetCurrentTime())
  }

  /**
   * Pause playback
   */
  pause() {
    if (this.state.playing) {
      this.time.seek = this.handleGetCurrentTime()
      this.state.playing = false
      // Only emit when actually transitioning from playing to paused
      this.event.emit('pause', this.time.seek)
    }
    this.driver.cancel()
  }

  /**
   * Stop playback
   */
  dispose() {
    this.pause()
    this.event.clear()
    this.config.event.remove('update', this.onConfigUpdate)

    this.active.lines = []
    this.active.index = []

    this.info = Lyric.Parsed.makeParsedInfo()
  }

  /**
   * Update the temp offset in ms (the user's temporary adjustment).
   *
   * Stacked on top of the global config offset and the lyric's meta offset, then resyncs immediately.
   *
   * @param value temp offset in ms; non-finite values are treated as 0.
   */
  updateTempOffset(value: number) {
    this.offset.setTemp(value)
    this.handleSyncTime()
  }

  /**
   * Find all active lines at the given time (ms). Does not mutate internal state.
   *
   * Assumes `info.lines` is sorted by `time.start` ascending.
   *
   * @param time time in ms to find active lines for.
   */
  matchLinesWithTime(time: number): { lines: Lyric.Parsed.ParsedLine[]; index: number[] } {
    const effective = time + this.currentOffset
    const lines: Lyric.Parsed.ParsedLine[] = []
    const index: number[] = []
    for (let i = 0; i < this.info.lines.length; i++) {
      const line = this.info.lines[i]
      const time = Lyric.Parsed.getParsedLineTime(line)
      // Lines are assumed sorted by time.start ascending, so the first line starting after `time` ends the scan.
      if (time!.start > effective) {
        break
      }
      if (this.merger.getMergedTime(i) > effective) {
        lines.push(line)
        index.push(i)
      }
    }
    return this.handleBridgeActive(lines, index)
  }

  /**
   * Convert a content (lyric) time to the playback clock by removing the active offset.
   *
   * Seeking playback to the returned time makes a line at `contentTime` become active.
   *
   * @param contentTime content time in ms (e.g. a line's start).
   */
  convertContentTime(contentTime: number): number {
    return contentTime - this.currentOffset
  }

  /**
   * Whether the player is currently playing.
   */
  get currentPlaying() {
    return this.state.playing
  }

  /**
   * Current active lines.
   */
  get currentLines(): Lyric.Parsed.ParsedLine[] {
    return this.handleBridgeActive(this.active.lines, this.active.index).lines
  }

  /**
   * Indices of currently active lines.
   */
  get currentIndex() {
    return this.handleBridgeActive(this.active.lines, this.active.index).index
  }

  /**
   * The index of the primary active line, or -1 if none.
   */
  get currentActive() {
    return this.handleGetActiveIndex()
  }

  /**
   * The current lyric info object.
   */
  get currentInfo(): Lyric.Parsed.Info {
    return this.info
  }

  /**
   * The current playback time in ms.
   */
  get currentTime() {
    return this.handleGetCurrentTime()
  }

  /**
   * The current effective lyric offset in ms (config offset + lyric meta offset + temp offset).
   */
  get currentOffset() {
    return this.offset.resolve(this.config.current.offset.global)
  }
}
