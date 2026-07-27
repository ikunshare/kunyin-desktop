import type { BaseLyricPlayer } from '../../base'
import type { DomLyricPlayerConfig } from '../config'
import type { ComponentContext, Root, Container } from '../components'

interface ScrollState {
  active: boolean
  activeIndex: number
}
interface ComponentState {
  root: Root
  container: Container
  context: ComponentContext
}

export class CoreContext {
  private isDestroyed = false

  public readonly player: BaseLyricPlayer
  public readonly config: DomLyricPlayerConfig.RootManager
  public readonly component: ComponentState
  public readonly scroll: ScrollState = {
    active: false,
    activeIndex: -1
  }

  constructor(
    player: BaseLyricPlayer,
    config: DomLyricPlayerConfig.RootManager,
    root: Root,
    container: Container,
    componentContext: ComponentContext
  ) {
    this.player = player
    this.config = config
    this.component = { root, container, context: componentContext }
  }

  get destroyed() {
    return this.isDestroyed
  }

  destroy() {
    this.isDestroyed = true

    this.scroll.active = false
    this.scroll.activeIndex = -1
  }
}
