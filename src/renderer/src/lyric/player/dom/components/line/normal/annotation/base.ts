import type { Lyric } from '../../../../../../kit/lyric'

import { applyClassName, applyRole } from '../../../../utils'

export abstract class AnnotationBaseElement {
  protected readonly content: HTMLDivElement
  private readonly text: string

  constructor(
    info: Lyric.Parsed.ParsedLineContent,
    language: Lyric.LanguageTag | undefined,
    role: string,
    style: string
  ) {
    this.text = this.resolve(info, language) ?? ''

    this.content = document.createElement('div')
    this.content.innerText = this.text

    applyClassName(this.content, [style])
    applyRole(this.content, role)
  }

  protected abstract resolve(
    info: Lyric.Parsed.ParsedLineContent,
    language: Lyric.LanguageTag | undefined
  ): string | undefined

  dispose() {
    this.content.remove()
  }

  get hasContent() {
    return this.text.length > 0
  }

  get element() {
    return this.content
  }
}
