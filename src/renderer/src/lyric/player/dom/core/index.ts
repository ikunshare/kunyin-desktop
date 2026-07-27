import type { Lyric } from '../../../kit/lyric'
import type { DomLyricPlayerEventMap } from '../interface'

import { BaseLyricPlayer } from '../../base'
import { ConfigManager, Event, hasKeyContaining } from '../../utils'

import { DomLyricPlayerConfig } from '../config'
import { ComponentContext, Root, Container } from '../components'
import { PlayerState } from '../constants'

import { FrameScheduler } from '../utils'

import { CoreContext } from './context'
import { ScrollManager } from './scroll'
import { LineManager } from './line'
import { LayoutManager } from './layout'
import { StyleManager } from './style'

export class DomLyricPlayer {
  public config: DomLyricPlayerConfig.RootManager
  public readonly event: Event<DomLyricPlayerEventMap> = new Event()

  private context: CoreContext
  private player: BaseLyricPlayer

  private root: Root
  private container: Container

  private scrollManager: ScrollManager
  private lineManager: LineManager
  private layoutManager: LayoutManager
  private styleManager: StyleManager

  private frameScheduler: FrameScheduler

  private pendingUpdateLayout = false
  private pendingUpdateSize = false
  private pendingIsSeek = false

  constructor(player: BaseLyricPlayer) {
    // DEFAULT is a partial default set whose syllable and annotation styles inherit the parent line.
    // It therefore cannot satisfy RootRequired structurally, so assert it at this boundary.
    const config = new ConfigManager(
      DomLyricPlayerConfig.DEFAULT as DomLyricPlayerConfig.RootRequired,
      {}
    )

    const componentContext = new ComponentContext(config)

    const root = new Root()
    const container = new Container(componentContext, root.element)

    const context = new CoreContext(player, config, root, container, componentContext)

    this.config = config
    this.context = context
    this.player = player

    this.root = root
    this.container = container

    this.lineManager = new LineManager(context)
    this.scrollManager = new ScrollManager(context, this.handleScroll)
    this.layoutManager = new LayoutManager(context, this.lineManager)
    this.styleManager = new StyleManager(context)

    this.frameScheduler = new FrameScheduler()

    this.player.event.add('play', this.onPlay)
    this.player.event.add('pause', this.onPause)
    this.player.event.add('lyricUpdate', this.onLyricUpdate)
    this.player.event.add('linesUpdate', this.onLinesUpdate)

    this.container.event.add('changeSize', this.onSizeUpdate)

    this.config.event.add('update', this.onConfigUpdate)

    componentContext.event.add('lineClick', this.handleLineClick)
    componentContext.event.add('lineContextMenu', this.handleLineContextMenu)
  }

  private flushLayoutUpdate = () => {
    this.pendingUpdateLayout = false

    const updateSize = this.pendingUpdateSize
    const isSeek = this.pendingIsSeek
    this.pendingUpdateSize = false
    this.pendingIsSeek = false

    if (updateSize) {
      this.lineManager.updateSize()
    }

    // If update size or seek, need force call play or pause.
    this.layoutManager.update(isSeek || updateSize)
  }
  private scheduleLayoutUpdate(options?: { updateSize?: boolean; isSeek?: boolean }) {
    if (options?.updateSize) {
      this.pendingUpdateSize = true
    }
    if (options?.isSeek) {
      this.pendingIsSeek = true
    }

    if (this.pendingUpdateLayout) {
      return
    }
    this.pendingUpdateLayout = true

    this.frameScheduler.request(this.flushLayoutUpdate)
  }

  private onSizeUpdate = () => {
    this.scheduleLayoutUpdate({
      updateSize: true
    })
  }

  private onConfigUpdate = (keys: DomLyricPlayerConfig.RootKeySet) => {
    this.container.updateConfig()
    this.styleManager.updateConfig(keys)
    this.lineManager.updateConfig(keys)

    // A render-mode swap, the per-word roman / ruby rows, their order, a language change, or a line-level annotation toggle resizes the cells and shifts the baseline, so re-measure and force a play / pause pass.
    const needUpdateSize =
      hasKeyContaining(keys, 'font') ||
      hasKeyContaining(keys, 'line.normal.main.use') ||
      hasKeyContaining(keys, 'line.normal.main.syllable.annotation.roman') ||
      hasKeyContaining(keys, 'line.normal.main.syllable.annotation.ruby') ||
      hasKeyContaining(keys, 'line.normal.main.syllable.sort') ||
      hasKeyContaining(keys, 'line.normal.annotation.visible') ||
      hasKeyContaining(keys, 'line.normal.annotation.translate.visible') ||
      hasKeyContaining(keys, 'line.normal.annotation.roman.visible') ||
      hasKeyContaining(keys, 'language')

    if (needUpdateSize) {
      // Heights may change, so drop the off-window estimates; they refill as built lines re-measure.
      this.lineManager.invalidateHeightEstimates()
    }

    this.scheduleLayoutUpdate({ updateSize: needUpdateSize })
  }

  private onPlay = (_currentTime: number) => {
    this.scheduleLayoutUpdate()
  }

  private onPause = (currentTime: number) => {
    const activeElementSet = this.lineManager.queryActiveElementSet(this.player.currentIndex)

    for (const [index, element] of this.lineManager.elementMap) {
      element.pause(currentTime, activeElementSet.has(index))
    }
  }

  private onLyricUpdate = (_info: Lyric.Parsed.Info) => {
    this.scrollManager.clear()
    this.lineManager.updateLines(this.player.currentInfo)
    this.layoutManager.reset()
    this.scheduleLayoutUpdate({
      updateSize: true
    })
  }

  private onLinesUpdate = (
    _lines: Lyric.Parsed.ParsedLine[],
    _indexes: number[],
    _index: number,
    isSeek: boolean
  ) => {
    this.scheduleLayoutUpdate({
      isSeek
    })
  }

  private handleScroll = (_line: number, scrolling: boolean) => {
    if (this.context.destroyed) {
      return
    }

    if (scrolling) {
      this.container.setAttribute(PlayerState.container.scrolling)
    } else {
      this.container.removeAttribute(PlayerState.container.scrolling)
    }

    this.layoutManager.update()
  }

  private resolveLine(index: number): Lyric.Parsed.ParsedLine | null {
    if (this.context.destroyed) {
      return null
    }

    const lines = this.player.currentInfo.lines
    if (index < 0 || index >= lines.length) {
      return null
    }

    return lines[index]
  }

  private handleLineClick = (index: number, event: MouseEvent) => {
    const line = this.resolveLine(index)
    if (line) {
      this.event.emit('lineClick', line, index, event)
    }
  }

  private handleLineContextMenu = (index: number, event: MouseEvent) => {
    const line = this.resolveLine(index)
    if (line) {
      this.event.emit('lineContextMenu', line, index, event)
    }
  }

  get element() {
    return this.root.element
  }

  get instanceId() {
    return this.root.instanceId
  }

  destroy() {
    this.player.event.remove('play', this.onPlay)
    this.player.event.remove('pause', this.onPause)
    this.player.event.remove('lyricUpdate', this.onLyricUpdate)
    this.player.event.remove('linesUpdate', this.onLinesUpdate)

    this.container.event.remove('changeSize', this.onSizeUpdate)
    this.config.event.remove('update', this.onConfigUpdate)

    this.context.component.context.event.remove('lineClick', this.handleLineClick)
    this.context.component.context.event.remove('lineContextMenu', this.handleLineContextMenu)

    this.context.destroy()

    this.frameScheduler.destroy()

    this.scrollManager.destroy()
    this.lineManager.destroy()

    this.styleManager.destroy()
    this.container.destroy()
    this.root.destroy()

    this.event.clear()
  }
}
