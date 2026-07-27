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

  private client: DomLyricPlayerConfig.RootManager

  constructor(client: DomLyricPlayerConfig.RootManager) {
    this.client = client
  }

  get config() {
    return this.client.current
  }
}
