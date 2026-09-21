import { Event } from '../../utils'
import { DomLyricPlayerConfig } from '../config'

export interface ComponentEventMap {
  /**
   * When a line's DOM is clicked, carrying the owning line index.
   * @param index The owning line's index in the current lyric info.
   * @param event The original DOM mouse event.
   */
  lineClick: (index: number, event: MouseEvent) => void

  /**
   * When a line's DOM is right-clicked, carrying the owning line index.
   * @param index The owning line's index in the current lyric info.
   * @param event The original DOM mouse event.
   */
  lineContextMenu: (index: number, event: MouseEvent) => void
}

export class ComponentContext {
  readonly event: Event<ComponentEventMap> = new Event()

  /**
   * [vendor patch] Host playback rate, mirrored from `BaseLyricPlayer`.
   *
   * The per-word animations are WAAPI animations on the wall clock, while the line
   * clock already advances at this rate — without mirroring it here the wipe would
   * run at 1x under a 2x host and drift away from the line it belongs to.
   */
  playbackRate = 1

  private client: DomLyricPlayerConfig.RootManager

  constructor(client: DomLyricPlayerConfig.RootManager) {
    this.client = client
  }

  get config() {
    return this.client.current
  }
}
