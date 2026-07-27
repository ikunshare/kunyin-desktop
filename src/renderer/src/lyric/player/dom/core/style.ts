import type { DomLyricPlayerConfig } from '../config'
import type { CoreContext } from './context'

import { hasKeyContainingAny } from '../../utils'

import { buildRootVariableKey } from '../utils'

const WATCH_KEYS: DomLyricPlayerConfig.RootKeys[] = [
  'line',
  'container.padding',
  'container.fade',
  'scroll.animation.easing'
]

export class StyleManager {
  private readonly runtime: HTMLStyleElement
  private readonly embed: HTMLStyleElement
  private readonly scope: string

  constructor(private readonly context: CoreContext) {
    const host = context.component.root.element
    this.scope = context.component.root.scope

    this.embed = document.createElement('style')
    this.embed.id = 'lyric-player-style-embed'
    this.embed.textContent = globalThis?.__LYRIC_PLAYER_STYLE__ || ''
    host.appendChild(this.embed)

    this.runtime = document.createElement('style')
    this.runtime.id = 'lyric-player-style-runtime'
    host.appendChild(this.runtime)

    // init styles
    this.updateConfig()
  }

  private buildKey(key: string) {
    return buildRootVariableKey(key)
  }

  private buildItem(key: string, value: string) {
    return `${this.buildKey(key)}: ${value};`
  }

  private apply(targets: Record<string, string>) {
    const result = Object.entries(targets)
      .map(([key, value]) => this.buildItem(key, value))
      .join('\n')

    if (!result.trim()) {
      return
    }

    const target = `${this.scope} {\n${result}\n}`

    this.runtime.textContent = target
  }

  private buildNormalLineValue(
    fallbackType: string | undefined,
    value: string | number | undefined,
    suffix: string,
    unit: string = ''
  ) {
    if (value === void 0 || value === null || value === '') {
      if (!fallbackType) {
        return ''
      }
      return `var(${this.buildKey(`line-${fallbackType}-${suffix}`)})`
    }
    return `${value}${unit}`
  }

  /**
   * Normalizes a font size into a CSS length, treating a bare number as `px` and passing length strings through unchanged.
   */
  private resolveFontSize(size: string | number | undefined) {
    return typeof size === 'number' ? `${size}px` : size
  }

  private buildNormalLineConfig(
    type: string,
    config: DomLyricPlayerConfig.Line.Normal.Base | undefined,
    fallbackType?: string
  ) {
    if (!config) {
      return {}
    }
    const block: Record<string, string> = {
      [`line-${type}-color`]: this.buildNormalLineValue(
        fallbackType,
        config.style?.normal?.color,
        'color'
      ),
      [`line-${type}-opacity`]: this.buildNormalLineValue(
        fallbackType,
        config.style?.normal?.opacity,
        'opacity'
      ),
      [`line-${type}-active-color`]: this.buildNormalLineValue(
        fallbackType,
        config.style?.active?.color,
        'active-color'
      ),
      [`line-${type}-active-opacity`]: this.buildNormalLineValue(
        fallbackType,
        config.style?.active?.opacity,
        'active-opacity'
      ),
      [`line-${type}-played-color`]: this.buildNormalLineValue(
        fallbackType,
        config.style?.played?.color,
        'played-color'
      ),
      [`line-${type}-played-opacity`]: this.buildNormalLineValue(
        fallbackType,
        config.style?.played?.opacity,
        'played-opacity'
      ),
      [`line-${type}-font-size`]: this.buildNormalLineValue(
        fallbackType,
        this.resolveFontSize(config.font?.size),
        'font-size'
      ),
      [`line-${type}-font-family`]: this.buildNormalLineValue(
        fallbackType,
        config.font?.family,
        'font-family'
      ),
      [`line-${type}-font-weight`]: this.buildNormalLineValue(
        fallbackType,
        config.font?.weight,
        'font-weight'
      )
    }
    return Object.fromEntries(Object.entries(block).filter(([_, v]) => v !== ''))
  }

  private buildInterludeConfig(config: DomLyricPlayerConfig.Line.Interlude.Root) {
    if (!config) {
      return {}
    }
    const getValue = (val: string | number | undefined, unit: string = '') => {
      return val === void 0 || val === null || val === '' ? '' : `${val}${unit}`
    }
    const block: Record<string, string> = {
      'line-interlude-size': getValue(config.size, 'px'),
      'line-interlude-color': getValue(config.style?.normal?.color),
      'line-interlude-opacity': getValue(config.style?.normal?.opacity),
      'line-interlude-active-color': getValue(config.style?.active?.color),
      'line-interlude-active-opacity': getValue(config.style?.active?.opacity)
    }
    return Object.fromEntries(Object.entries(block).filter(([_, v]) => v !== ''))
  }

  updateConfig(keys?: DomLyricPlayerConfig.RootKeySet) {
    if (keys && !hasKeyContainingAny(keys, WATCH_KEYS)) {
      return
    }

    const config = this.context.config.current
    const scroll = config.scroll
    const line = config.line

    const result = {
      // line
      ...this.buildNormalLineConfig('normal-base', line.normal.base),
      ...this.buildNormalLineConfig(
        'normal-main-syllable',
        line.normal.main.syllable,
        'normal-base'
      ),
      ...this.buildNormalLineConfig(
        'normal-main-syllable-roman',
        line.normal.main.syllable.annotation.roman,
        'normal-main-syllable'
      ),
      ...this.buildNormalLineConfig(
        'normal-main-syllable-ruby',
        line.normal.main.syllable.annotation.ruby,
        'normal-main-syllable'
      ),
      ...this.buildNormalLineConfig(
        'normal-annotation-base',
        line.normal.annotation.base,
        'normal-base'
      ),
      ...this.buildNormalLineConfig(
        'normal-annotation-translate',
        line.normal.annotation.translate,
        'normal-annotation-base'
      ),
      ...this.buildNormalLineConfig(
        'normal-annotation-roman',
        line.normal.annotation.roman,
        'normal-annotation-base'
      ),
      // interlude
      ...this.buildInterludeConfig(line.interlude),
      // container
      'container-padding': `${config.container.padding}`,
      'container-fade-top': `${config.container.fade.top}`,
      'container-fade-bottom': `${config.container.fade.bottom}`,
      // scroll
      'scroll-easing': scroll.animation.easing
    }

    this.apply(result)
  }

  destroy() {
    this.runtime.remove()
    this.embed.remove()
  }
}
