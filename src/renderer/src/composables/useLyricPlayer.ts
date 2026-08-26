import { onUnmounted, shallowRef, type ShallowRef } from 'vue'
import { Lyric, ParserPipeline } from 'music-lyric-kit'
import { BaseLyricPlayer, DomLyricPlayer, DomLyricPlayerConfig } from 'music-lyric-player'
import { realignByIndex } from './lyricAlign'
import {
  attachWordRomans,
  hasSyllableTags,
  reconstructWordDurations,
  stripSyllableTags
} from './attachWordRomans'

/**
 * 音源塞进歌词轨的噪音行（AI 音译声明等）——不是制作人信息，kit 的 extractCreator 不认，
 * 必须自行剔除。正文置空但保留时间标签，避免打乱主/译/音译 1:1 行对齐。
 * 匹配前先剥掉逐字 <...> 标签，否则增强 LRC 会漏过滤。
 */
const NOISE_CONTENT_RE =
  /音译标注|音譯標註|由\s*AI\s*工具|AI\s*工具生产|AI\s*工具生產|AI\s*生成|以下.+AI/i

/**
 * 制作人/职务行（作词、作曲、混音师……）。
 *
 * 主轨**不再**在这里剔除：交给 kit 的 pure.extractCreator 结构化提取到 meta.credits
 * （replace 默认 true，会把行从正文移除），既能在歌词末尾展示这些信息，
 * 又比这里手写的正则覆盖得广（kit 内置数百条职务规则）。
 * 副轨（翻译/音译）不走 extractCreator，仍在此直接剔除——制作人信息糊在注解位上没意义。
 */
const CREDIT_CONTENT_RE =
  /作[词詞曲]\s*[:：]|作曲\s*[:：]|编曲\s*[:：]|編曲\s*[:：]|填[词詞]\s*[:：]|谱曲\s*[:：]|譜曲\s*[:：]|演唱\s*[:：]|制作人?\s*[:：]|製作人?\s*[:：]|监制\s*[:：]|監制\s*[:：]|词曲\s*[:：]|詞曲\s*[:：]|lyricist\s*[:：]|composer\s*[:：]|arranger\s*[:：]|additional\s+vocal[s]?\s+by\s*[:：]|repertoire\s+owner\s*[:：]/i

/** 中文职务后直接拼英文职务是 QQ/酷狗歌词常见格式，例如「和声Backing Vocals：…」。 */
const CREDIT_PREFIX_RE =
  /^(?:作[词詞曲]|曲|词|詞|编曲|編曲|填[词詞]|谱曲|譜曲|演唱|制作人?|製作人?|监制|監制|词曲|詞曲|吉他|混音师|混音師|母带后期混音师|母帶後期混音師|和声编写|和聲編寫|和声|和聲|配唱制作人|配唱製作人|录音师|錄音師|人声编辑|人聲編輯|视觉设计|視覺設計|艺人统筹|藝人統籌|推广策划|推廣策劃|特别合作|特別合作|混音棚|录音棚|錄音棚|企划营销|企劃營銷|制作公司|製作公司|蒙古长调|蒙古長調|OP|SP)(?:\s*[A-Za-z][A-Za-z0-9 .&/'’()_-]*)?\s*[:：]/i

function isNoiseContent(text: string): boolean {
  return NOISE_CONTENT_RE.test(text)
}

function isCreditContent(text: string): boolean {
  return CREDIT_CONTENT_RE.test(text) || CREDIT_PREFIX_RE.test(text)
}

function plainLyricBody(text: string): string {
  return text
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * 剔除元信息行。
 * @param dropCredits 是否连制作人行一并剔除。副轨传 true；主轨传 false，
 *   把制作人行留给 kit 的 extractCreator 提取成 meta.credits。
 */
function stripMetaLines(lrc: string, dropCredits: boolean): string {
  if (!lrc?.trim()) return lrc || ''
  const shouldDrop = (text: string): boolean =>
    isNoiseContent(text) || (dropCredits && isCreditContent(text))
  return lrc
    .split(/\r?\n/)
    .map((line) => {
      const m = line.match(/^(\[[^\]]+\])(.*)$/)
      if (!m) {
        const content = plainLyricBody(line)
        if (content && shouldDrop(content)) return ''
        return line
      }
      const [, tag, content] = m
      const text = plainLyricBody(content)
      // 保留时间标签，正文置空，避免 realignByIndex 行数错位
      if (text && shouldDrop(text)) return tag
      return line
    })
    .join('\n')
}

/**
 * 判断翻译/音译文本是否「实质为空」——所有行的正文剥字后都无字符。
 * QQ QRC trans 常见空翻译轨（时间标签在但正文空/仅空白），传给 kit 会占一整行的高。
 */
function isAnnotationEmpty(text: string): boolean {
  if (!text?.trim()) return true
  for (const raw of text.split(/\r?\n/)) {
    const body = raw.replace(/^\[[^\]]+\]/, '')
    if (plainLyricBody(body)) return false
  }
  return true
}

/**
 * 把「无翻译占位行」（QQ trans 用 `//` 表示该行没有翻译）正文置空，保留时间标签。
 * 渲染层对空正文注解不建行（hasContent 检查），置空即隐藏；保留标签维持行数供索引对齐。
 */
function stripPlaceholderLines(text: string): string {
  if (!text?.trim()) return text || ''
  return text
    .split(/\r?\n/)
    .map((line) => {
      const m = line.match(/^(\[[^\]]+\])(.*)$/)
      if (!m) return line
      const body = plainLyricBody(m[2])
      return body && /^[/\\]+$/.test(body) ? m[1] : line
    })
    .join('\n')
}

/** 翻译/音译轨统一清洗：剥元信息行（含制作人行）→ 置空占位行 → 整轨实质为空则丢弃 */
function cleanAnnotationTrack(text: string): string {
  if (!text?.trim()) return ''
  const cleaned = stripPlaceholderLines(stripMetaLines(text, true))
  return isAnnotationEmpty(cleaned) ? '' : cleaned
}

/** 歌词末尾展示的制作人信息（由 kit 的 extractCreator 从歌词行里提取） */
export interface LyricCredit {
  role: string
  names: string[]
}

/**
 * 把 credits 渲染进引擎的歌词末尾附注区。
 *
 * 挂在引擎 footer 里（而非歌词面板底部的独立区块），才能跟着最后一行一起滚动——
 * Apple Music 的 credits 就是歌词流的收尾部分，不是常驻页脚。
 * 样式走宿主提供的 class（见 PlayerView 的 :deep(.lyric-credits*)）。
 */
function renderCredits(host: HTMLElement, list: readonly LyricCredit[]): void {
  if (!list.length) {
    host.replaceChildren()
    return
  }
  const frag = document.createDocumentFragment()
  for (const item of list) {
    const row = document.createElement('div')
    row.className = 'lyric-credits-row'
    const role = document.createElement('span')
    role.className = 'lyric-credits-role'
    role.textContent = item.role
    const names = document.createElement('span')
    names.className = 'lyric-credits-names'
    names.textContent = item.names.join(' · ')
    row.append(role, names)
    frag.appendChild(row)
  }
  const box = document.createElement('div')
  box.className = 'lyric-credits'
  box.appendChild(frag)
  host.replaceChildren(box)
}

/**
 * 把 kit 的 meta.credits 收敛成 UI 直接可用的形状：
 * 同一职务的多行合并、去重、丢掉空值——音源常把「作词」分成好几行给出。
 */
function toCredits(raw: readonly { role: string; names: { content: string }[] }[]): LyricCredit[] {
  const merged = new Map<string, string[]>()
  for (const item of raw) {
    const role = item.role?.trim()
    if (!role) continue
    const names = merged.get(role) ?? []
    for (const n of item.names) {
      const name = n?.content?.trim()
      if (name && !names.includes(name)) names.push(name)
    }
    if (names.length) merged.set(role, names)
  }
  return [...merged].map(([role, names]) => ({ role, names }))
}

/**
 * 封装 music-lyric-player 的逐字歌词引擎（对齐上游 playground core/parser.ts + usePlayer.ts）。
 * - 主歌词/翻译/音译一并喂 ParserPipeline 的 content.{original,translate,roman}，由 kit 按时间对齐。
 * - roman 若带逐字时间标签：行级先 strip 再喂 kit；解析后再用原轨挂 word.annotation.romans。
 * - parse() 后链式执行 kit 的 transform 插件，得到富模型再 base.updateLyric 渲染。
 * - dom 前景改白色系（Apple Music 招牌），driver=animation 自走逐字擦除。
 * - 翻译/音译用更小字号 + 更低不透明度，与主词分层，避免糊成一团。
 */
export function useLyricPlayer(): {
  element: ShallowRef<HTMLElement>
  loadLyric: (
    original: string,
    translate?: string,
    roman?: string,
    musicInfo?: { name?: string; singer?: string[] }
  ) => void
  clear: () => void
  play: (ms?: number) => void
  pause: () => void
  seekMs: (ms: number) => void
  setColors: (normal: string, active: string) => void
  setFontFamily: (font: string) => void
  setPresentation: (opts: {
    fontSize: number
    gap: number
    align: 'left' | 'center' | 'right'
    scrollAlign: 'top' | 'center'
    delayScroll: boolean
    zoomActive: boolean
  }) => void
  setAnnotationVisible: (opts: { translation?: boolean; romanization?: boolean }) => void
  /** 宿主从 hidden→可见后调用，强制按真实尺寸重排（避免行高测成 0 叠在一起） */
  relayout: () => void
  /** 歌词引擎当前是否在推进播放（与宿主音频播放状态解耦；桌面歌词据此判断是否需重新 play） */
  playing: ShallowRef<boolean>
  /**
   * 当前歌词里的制作人信息（作词/作曲/混音…）。
   * 由 kit 的 pure.extractCreator 从歌词行提取，这些行本身不会出现在唱词里；
   * 开启 setCreditsVisible 后会作为歌词流的收尾跟着最后一行一起滚动。
   */
  credits: ShallowRef<LyricCredit[]>
  /** 是否在歌词末尾展示制作人信息（默认关闭；桌面歌词等紧凑宿主保持关闭） */
  setCreditsVisible: (visible: boolean) => void
} {
  const base = new BaseLyricPlayer()
  const dom = new DomLyricPlayer(base)

  base.config.merge({ driver: 'animation' })

  // 主词 → 翻译 → 音译；逐字音译挂在每个字下方（字距靠 CSS 不让拼音撑宽）
  dom.config.merge({
    layout: {
      gap: 36,
      align: 'left'
    },
    effect: {
      // 引擎默认对非激活行做距离渐变高斯模糊（max 4.5px），
      // 整页看起来虚焦、亮底下更糊；关掉，非激活行只做透明度分层
      blur: { enabled: false }
    },
    line: {
      normal: {
        // 默认 [roman, main, translate] → 主词→翻译→行级音译（无逐字数据时回退）
        sort: [
          DomLyricPlayerConfig.Line.Normal.LineSlot.Main,
          DomLyricPlayerConfig.Line.Normal.LineSlot.AnnotationTranslate,
          DomLyricPlayerConfig.Line.Normal.LineSlot.AnnotationRoman
        ],
        base: {
          font: { size: 28, weight: 600 }
        },
        annotation: {
          visible: true,
          base: {
            font: { size: '0.52em', weight: 400 },
            style: {
              normal: { opacity: 0.42 },
              active: { opacity: 0.62 },
              played: { opacity: 0.32 }
            }
          },
          translate: { visible: true },
          roman: { visible: true }
        },
        main: {
          syllable: {
            // 汉字在上、逐字音译在下
            sort: [
              DomLyricPlayerConfig.Line.Normal.Syllable.WordSlot.Word,
              DomLyricPlayerConfig.Line.Normal.Syllable.WordSlot.AnnotationRoman,
              DomLyricPlayerConfig.Line.Normal.Syllable.WordSlot.AnnotationRuby
            ],
            annotation: {
              // 字与字之间留一点拼音间隙，避免相邻音节的音译撞成连体（"sisoengong"）
              gap: 4,
              roman: {
                // 逐字音译字号直接决定字距：cell 宽取 max(汉字, 拼音)，拼音一比汉字宽
                // 就把汉字撑开。0.45em 时常见 3~4 字母音节恰好不超过一个汉字宽。
                visible: true,
                font: { size: '0.45em', weight: 400 }
              }
            }
          }
        }
      }
    }
  })

  function setColors(normal: string, active: string): void {
    // 注解与主词同色相，靠 opacity 分层，避免和主词糊成一块
    dom.config.merge({
      line: {
        normal: {
          base: {
            style: {
              normal: { color: normal },
              active: { color: active },
              played: { color: active }
            }
          },
          annotation: {
            base: {
              style: {
                normal: { color: normal, opacity: 0.42 },
                active: { color: active, opacity: 0.62 },
                played: { color: normal, opacity: 0.32 }
              }
            }
          }
        },
        interlude: {
          style: {
            normal: { color: normal },
            active: { color: active }
          }
        }
      }
    })
  }
  // 默认 Apple Music 白色系（主窗口全屏播放器用）
  setColors('#ffffff', '#ffffff')

  /** 设歌词字体（空=跟随宿主字体）。写入引擎基础字体配置，让主词、翻译和音译的变量链一起更新。 */
  function setFontFamily(font: string): void {
    const family = font ? `"${font.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"` : 'inherit'
    dom.config.merge({
      line: {
        normal: {
          base: { font: { family } }
        }
      }
    })
  }

  /** 桌面歌词等紧凑宿主可动态覆盖排版，但不替换逐字动画驱动。 */
  function setPresentation(opts: {
    fontSize: number
    gap: number
    align: 'left' | 'center' | 'right'
    scrollAlign: 'top' | 'center'
    delayScroll: boolean
    zoomActive: boolean
  }): void {
    dom.config.merge({
      layout: {
        align: opts.align,
        gap: Math.max(0, opts.gap)
      },
      effect: {
        scale: {
          enabled: opts.zoomActive,
          min: 0.92,
          max: 1.08
        }
      },
      scroll: {
        anchor: opts.scrollAlign === 'top' ? 24 : 50,
        animation: {
          mode: DomLyricPlayerConfig.Scroll.Animation.Mode.Smooth,
          duration: opts.delayScroll ? 620 : 360,
          easing: opts.delayScroll ? 'cubic-bezier(0.22, 1, 0.36, 1)' : 'ease',
          smooth: { delay: opts.delayScroll ? 100 : 0 }
        }
      },
      line: {
        normal: {
          base: {
            font: { size: Math.max(10, Math.min(80, Math.round(opts.fontSize))) }
          }
        }
      }
    })
  }

  function setAnnotationVisible(opts: { translation?: boolean; romanization?: boolean }): void {
    const patch: Record<string, unknown> = {}
    if (opts.translation !== undefined) {
      patch.translate = { visible: opts.translation }
    }
    if (opts.romanization !== undefined) {
      patch.roman = { visible: opts.romanization }
    }
    if (!Object.keys(patch).length) return
    // 行级翻译/音译 + 逐字音译同步（有逐字数据时引擎会隐藏行级音译行）
    dom.config.merge({
      line: {
        normal: {
          annotation: patch,
          main: {
            syllable: {
              annotation: {
                roman: opts.romanization !== undefined ? { visible: opts.romanization } : undefined
              }
            }
          }
        }
      }
    })
  }

  const element = shallowRef<HTMLElement>(dom.element)

  /**
   * 歌词引擎真实播放状态，而非宿主音频状态。
   * 引擎 `updateLyric()` 内部会 `pause()`、`seekMs` = play+pause，最终都回到暂停；
   * 只有 `play()` 会推进。桌面歌词用它判断「歌词是否真的在走」——比依赖宿主推送的
   * playing 可靠：歌词异步拉取期间的中间态（hasLyric=false 但 playing=true）不会误判。
   */
  const playing = shallowRef(false)
  const credits = shallowRef<LyricCredit[]>([])
  /** 是否把 credits 渲染到歌词末尾（桌面歌词等紧凑宿主关掉） */
  let creditsEnabled = false

  function applyCredits(): void {
    if (!creditsEnabled) return
    renderCredits(dom.footerElement, credits.value)
    dom.refreshFooter()
  }

  /** 开启后，制作人信息会作为歌词流的收尾跟着最后一行一起滚动 */
  function setCreditsVisible(visible: boolean): void {
    if (creditsEnabled === visible) return
    creditsEnabled = visible
    if (visible) {
      renderCredits(dom.footerElement, credits.value)
    } else {
      renderCredits(dom.footerElement, [])
    }
    dom.refreshFooter()
  }

  const onEnginePlay = (): void => {
    playing.value = true
  }
  const onEnginePause = (): void => {
    playing.value = false
  }
  base.event.add('play', onEnginePlay)
  base.event.add('pause', onEnginePause)

  function clear(): void {
    credits.value = []
    applyCredits()
    base.updateLyric(Lyric.Parsed.makeParsedInfo())
  }

  /**
   * 强制容器 reflow，促使 ResizeObserver 重新测量行高并排版。
   * 宿主曾用 display:none / 尺寸为 0 时测到的高度需要在可见后刷新。
   */
  function relayout(): void {
    const root = dom.element
    const container = (root.querySelector('[data-role="container"]') as HTMLElement | null) ?? root
    const prev = container.style.minHeight
    container.style.minHeight = `${Math.max(container.clientHeight, 1)}px`
    void container.offsetHeight
    container.style.minHeight = prev
  }

  /**
   * 喂增强 LRC（主 + 翻译 + 音译），跑完整 transform 管线后渲染。
   * @param roman 行级或逐字音译；若含时间标签会自动拆成行级 + 逐字挂接
   */
  function loadLyric(
    original: string,
    translate = '',
    roman = '',
    musicInfo?: { name?: string; singer?: string[] }
  ): void {
    if (!original.trim()) {
      clear()
      return
    }
    try {
      // 去掉 AI 音译声明等噪音行；制作人行留着，交给下面的 pure.extractCreator 提取
      const cleanedOriginal = stripMetaLines(original, false)
      // 副轨清洗：元信息行 + `//` 占位行置空；「实质为空」的轨整体丢掉，
      // 避免 kit 每行留出注解位撑高行。
      const cleanedTranslate = cleanAnnotationTrack(translate)
      const cleanedRoman = cleanAnnotationTrack(roman)

      // 翻译/音译按行索引重对齐到主轨时间戳，规避 kit 0 容差精确匹配导致的整行漏配
      const alignedTranslate = cleanedTranslate
        ? realignByIndex(cleanedOriginal, cleanedTranslate)
        : ''
      const alignedRomanRaw = cleanedRoman ? realignByIndex(cleanedOriginal, cleanedRoman) : ''
      // kit LRC 对 roman 强制行级解析：必须先剥掉逐字时间标签，否则标签会原样进 content
      const syllableRoman = hasSyllableTags(alignedRomanRaw) ? alignedRomanRaw : ''
      const alignedRoman = stripSyllableTags(alignedRomanRaw)

      const pipeline = new ParserPipeline({
        content: {
          original: cleanedOriginal,
          translate: alignedTranslate,
          roman: alignedRoman
        },
        musicInfo,
        format: 'lrc'
      }).parse()
      // transform 链（顺序对齐上游 playground buildPipeline）
      pipeline.pure.clean()
      pipeline.pure.extractCreator()
      pipeline.agent.extract()
      pipeline.background.extract()
      pipeline.background.clean()
      pipeline.interlude.insert()
      pipeline.space.insert()
      pipeline.stress.mark()
      pipeline.language.infer()
      pipeline.language.calculatePercent()

      const result = pipeline.final().result
      // extractCreator 已把制作人行从 lines 移出并结构化到 meta.credits，
      // 作为歌词流的收尾渲染到引擎 footer（跟着最后一行滚动）
      credits.value = toCredits(result.meta?.credits ?? [])
      applyCredits()
      // 绝对时间标签的词 end==start，补全时长供卡拉 OK / 重音；
      // 传原文以取行末时间标签（kit 的行 time.end 是末词 start，补不了末字）
      reconstructWordDurations(result, cleanedOriginal)
      // 逐字音译：用原轨音节对齐挂到 word.annotation.romans
      if (syllableRoman) {
        const ok = attachWordRomans(result, syllableRoman)
        if (!ok) {
          console.warn('[lyric] 逐字音译无法被解析，已回退为行级音译')
        }
      }
      // 背景人声留在 backgrounds 里交给引擎渲染行内子行（小字、按自身时间轴逐字擦除），
      // 不要拼回主词——拼接会让和声词排进主词时间轴末尾，时序全错。

      base.updateLyric(result)
    } catch (e) {
      console.error('[lyric] 解析失败', e)
      clear()
    }
  }

  function play(ms = 0): void {
    base.play(ms)
  }
  function pause(): void {
    base.pause()
  }
  function seekMs(ms: number): void {
    base.play(ms)
    base.pause()
  }

  onUnmounted(() => {
    base.event.remove('play', onEnginePlay)
    base.event.remove('pause', onEnginePause)
    dom.destroy()
  })

  return {
    element,
    loadLyric,
    clear,
    play,
    pause,
    seekMs,
    setColors,
    setFontFamily,
    setPresentation,
    setAnnotationVisible,
    relayout,
    playing,
    credits,
    setCreditsVisible
  }
}
