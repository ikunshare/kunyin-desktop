import { Lyric } from '../../../../../../kit/lyric'
import type { DomLyricPlayerConfig } from '../../../../config'

import { PlayerRole } from '../../../../constants'

import { applyClassName, applyRole } from '../../../../utils'

import styles from './index.module.scss'

export class PlainElement {
  private readonly dom: HTMLDivElement

  constructor(private readonly info: Lyric.Parsed.ParsedLineContent) {
    this.dom = document.createElement('div')
    this.updateConfig()
  }

  updateConfig(keys?: DomLyricPlayerConfig.RootKeySet) {
    if (!keys) {
      applyClassName(this.dom, [styles.plain])
      applyRole(this.dom, PlayerRole.line.normal.text.self)
      this.dom.innerText = Lyric.Parsed.getParsedLineText(this.info)
    }
  }

  updateSize() {}

  updateActive(active: boolean) {}

  play(currentTime: number, isActive: boolean) {}

  pause(currentTime: number, isActive: boolean) {}

  reset(currentTime: number) {}

  dispose() {
    this.dom.replaceChildren()
  }

  get element() {
    return this.dom
  }
}
