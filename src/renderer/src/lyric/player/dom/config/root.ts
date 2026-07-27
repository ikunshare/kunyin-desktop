import type { ConfigManager, DeepRequired, NestedKeys } from '../../utils'
import type { FontConfig } from './common'

import * as Line from './line'
import * as Effect from './effect'
import * as Scroll from './scroll'
import * as Layout from './layout'
import * as Container from './container'

import { freezeObjectDeep } from '../../utils'
import { DEFAULT_LANGUAGE, DEFAULT_SORT, DEFAULT_WORD_SORT } from '../utils'

/**
 * Top‑level configuration of the lyric player.
 *
 * Every field is optional — values not provided fall back to {@link DEFAULT}.
 * The shape is split by concern; each domain lives in its own sub‑module.
 */
export interface Root {
  /**
   * Outer wrapper: class name, padding and edge fade.
   */
  container?: Container.Root

  /**
   * Geometric layout: alignment and inter‑line spacing.
   */
  layout?: Layout.Root

  /**
   * Visual effects (scale, blur) driven by distance from the active line.
   */
  effect?: Effect.Root

  /**
   * Viewport scrolling and transition animation.
   */
  scroll?: Scroll.Root

  /**
   * Lyric line rendering: vocal lines and interlude markers.
   */
  line?: Line.Root
}

/**
 * Fully‑resolved config in which every field is required, produced by deep‑requiring the user‑facing {@link Root}.
 */
export type RootRequired = DeepRequired<Root>

/**
 * Runtime config manager bound to this module's {@link Root} shape.
 */
export type RootManager = ConfigManager<RootRequired, Root>

/**
 * All config keys
 */
export type RootKeys = NestedKeys<Root>

/**
 * Set of config key paths that changed since the previous value, as emitted by `ConfigManager.event['update']`.
 *
 * Components consume this to decide which parts to refresh.
 */
export type RootKeySet = Set<RootKeys>

export { Line, Effect, Scroll, Layout, Container }

const DEFAULT_COLOR = '#000000' as const

const DEFAULT_FONT_CONFIG: FontConfig = {
  size: 30,
  weight: 500,
  family: 'sans-serif'
} as const

/**
 * Built‑in default configuration.
 *
 * Used as the fallback when a user‑supplied {@link Root} omits fields.
 *
 * This is intentionally a partial default set: syllable and annotation font / style are left unset so they inherit the parent line at runtime (resolved via CSS variable fallbacks in StyleManager).
 * It is therefore typed as {@link Root} rather than {@link RootRequired}, and asserted back at the ConfigManager boundary.
 */
export const DEFAULT: Root = freezeObjectDeep({
  container: {
    className: '',
    padding: '20px',
    fade: {
      enabled: true,
      top: '5%',
      bottom: '10%'
    }
  },

  layout: {
    align: 'left',
    gap: 30,
    duet: {
      enabled: true
    }
  },

  effect: {
    scale: {
      enabled: false,
      min: 0.65,
      max: 1
    },
    blur: {
      enabled: true,
      min: 0.4,
      max: 4.5
    }
  },

  scroll: {
    anchor: 50,
    animation: {
      mode: Scroll.Animation.Mode.Smooth,
      duration: 500,
      easing: 'ease',
      smooth: {
        delay: 0
      },
      ripple: {
        range: 5,
        step: 40
      },
      directional: {
        range: 5,
        step: 40
      },
      stagger: {
        range: 4,
        step: 50
      }
    }
  },

  line: {
    className: '',
    animationWindow: 2,
    contentWindow: 6,
    normal: {
      sort: [...DEFAULT_SORT],
      base: {
        language: DEFAULT_LANGUAGE,
        font: DEFAULT_FONT_CONFIG,
        style: {
          normal: {
            color: DEFAULT_COLOR,
            opacity: 0.6
          },
          active: {
            color: DEFAULT_COLOR,
            opacity: 1
          },
          played: {
            color: DEFAULT_COLOR,
            opacity: 0.4
          }
        }
      },
      main: {
        use: 'syllable',
        syllable: {
          sort: [...DEFAULT_WORD_SORT],
          word: {
            animation: {
              float: {
                enabled: true,
                from: 0,
                to: -2
              },
              mask: {
                enabled: true,
                feather: {
                  normal: 0.5,
                  first: 1.5,
                  last: 0.5
                }
              },
              emphasize: {
                enabled: true,
                minDuration: 1000,
                disablePlaybackRate: 4,
                effects: {
                  main: {
                    enabled: true,
                    scale: 0.1,
                    offsetHorizontal: 1,
                    offsetVertical: 1,
                    easingRise: 'cubic-bezier(0.2, 0.4, 0.58, 1)',
                    easingFall: 'cubic-bezier(0.3, 0, 0.58, 1)'
                  },
                  glow: {
                    enabled: true,
                    color: '#000000',
                    easingRise: 'cubic-bezier(0.2, 0.4, 0.58, 1)',
                    easingFall: 'cubic-bezier(0.3, 0, 0.58, 1)',
                    maxRadius: 9,
                    maxAlpha: 1
                  },
                  float: {
                    enabled: true,
                    duration: {
                      scale: 1.4,
                      lead: 400
                    },
                    amplitude: 2,
                    easing: 'cubic-bezier(0.45, 0, 0.55, 1)',
                    background: {
                      enabled: true,
                      scale: 2
                    }
                  }
                }
              }
            }
          },
          annotation: {
            gap: 3,
            // [vendor patch] 上游此处无此项、行为等同 true（详见 annotation/index.ts 注释）。
            // 默认改 false：单 token 且时间窗与主词一致时随主词 mask 擦除，避免主词与音译各擦各的。
            forceOwnWipe: false,
            roman: {
              visible: true,
              font: {
                size: '0.5em'
              }
            },
            ruby: {
              visible: true,
              font: {
                size: '0.5em'
              }
            }
          }
        }
      },
      annotation: {
        visible: true,
        base: {
          font: {
            size: '0.6em'
          },
          style: {
            normal: {
              opacity: 0.4
            },
            active: {
              opacity: 0.6
            }
          }
        },
        translate: {
          visible: true
        },
        roman: {
          visible: true
        }
      }
    },
    interlude: {
      size: 16,
      style: {
        normal: {
          color: DEFAULT_COLOR,
          opacity: 0.2,
          hide: true
        },
        active: {
          color: DEFAULT_COLOR,
          opacity: 0.8
        }
      }
    }
  }
})
