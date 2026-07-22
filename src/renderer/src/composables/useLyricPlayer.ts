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
 * 音源塞进歌词轨的元信息行（非唱词）。
 * 正文置空但保留时间标签，避免打乱主/译/音译 1:1 行对齐。
 * 匹配前先剥掉逐字 <...> 标签，否则增强 LRC 会漏过滤。
 */
const META_CONTENT_RE =
  /音译标注|音譯標註|由\s*AI\s*工具|AI\s*工具生产|AI\s*工具生產|AI\s*生成|以下.+AI|作[词詞曲]\s*[:：]|作曲\s*[:：]|编曲\s*[:：]|編曲\s*[:：]|填[词詞]\s*[:：]|谱曲\s*[:：]|譜曲\s*[:：]|演唱\s*[:：]|制作人?\s*[:：]|製作人?\s*[:：]|监制\s*[:：]|監制\s*[:：]|词曲\s*[:：]|詞曲\s*[:：]|lyricist\s*[:：]|composer\s*[:：]|arranger\s*[:：]/i

function plainLyricBody(text: string): string {
  return text
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function stripMetaLines(lrc: string): string {
  if (!lrc?.trim()) return lrc || ''
  return lrc
    .split(/\r?\n/)
    .map((line) => {
      const m = line.match(/^(\[[^\]]+\])(.*)$/)
      if (!m) {
        const content = plainLyricBody(line)
        if (content && META_CONTENT_RE.test(content)) return ''
        return line
      }
      const [, tag, content] = m
      const text = plainLyricBody(content)
      // 保留时间标签，正文置空，避免 realignByIndex 行数错位
      if (text && META_CONTENT_RE.test(text)) return tag
      return line
    })
    .join('\n')
}

/**
 * 背景人声折叠回主行。
 *
 * kit 的 background.extract 会把括号伴唱拆成独立 background 行；
 * DOM 播放器再用 scale(0.7)+极小间距叠在主词下方，
 * 像「情人 - 蔡徐坤(KUN)」会把「KUN」压到「蔡徐坤」上。
 * 识别对不对先不管，这里只修 UI：拼回主行，不再单独渲染背景行。
 */
function foldBackgroundsIntoMain(result: Lyric.Parsed.Info): void {
  for (const line of result.lines) {
    if (!Lyric.Parsed.isParsedLineNormal(line)) continue
    const body = line.body.value
    const bgs = body.backgrounds
    if (!bgs?.length) continue

    const pending = bgs.slice()
    bgs.length = 0

    for (const bg of pending) {
      if (bg.words.length) {
        const last = body.words[body.words.length - 1]
        // 主词与背景词之间补空格，避免「蔡徐坤KUN」粘连
        if (last && !Lyric.Common.isWordSpace(last)) {
          body.words.push(Lyric.Common.makeWordSpace({ count: 1 }))
        }
        for (const w of bg.words) body.words.push(w)
      }

      // 扩展主行时间，覆盖背景时段
      if (bg.time) {
        if (!body.time) {
          body.time = Lyric.Common.makeTime({ start: bg.time.start, end: bg.time.end })
        } else {
          if (bg.time.start < body.time.start) body.time.start = bg.time.start
          if (bg.time.end > body.time.end) body.time.end = bg.time.end
        }
      }

      // 行级翻译/音译一并拼回主行（括号内伴唱的注解）
      if (!bg.annotation) continue
      const ann = body.annotation ?? (body.annotation = Lyric.Common.makeLineAnnotation())
      for (const t of bg.annotation.translations ?? []) {
        if (!t.content?.trim()) continue
        const existing = ann.translations.find((x) => x.language === t.language)
        if (existing) existing.content = `${existing.content} ${t.content}`.trim()
        else ann.translations.push(t)
      }
      for (const r of bg.annotation.romans ?? []) {
        if (!r.content?.trim()) continue
        const existing = ann.romans.find((x) => x.language === r.language)
        if (existing) existing.content = `${existing.content} ${r.content}`.trim()
        else ann.romans.push(r)
      }
    }
  }
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
  loadLyric: (original: string, translate?: string, roman?: string) => void
  clear: () => void
  play: (ms?: number) => void
  pause: () => void
  seekMs: (ms: number) => void
  setColors: (normal: string, active: string) => void
  setAnnotationVisible: (opts: { translation?: boolean; romanization?: boolean }) => void
  /** 宿主从 hidden→可见后调用，强制按真实尺寸重排（避免行高测成 0 叠在一起） */
  relayout: () => void
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
              // 不因注音额外加字间距（拼音过宽的撑开用 CSS absolute 消化）
              gap: 0,
              roman: {
                visible: true,
                font: { size: '0.4em', weight: 400 }
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

  function clear(): void {
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
  function loadLyric(original: string, translate = '', roman = ''): void {
    if (!original.trim()) {
      clear()
      return
    }
    try {
      // 去掉 AI 音译声明等元信息行，避免当成唱词/翻译糊在标题上
      const cleanedOriginal = stripMetaLines(original)
      const cleanedTranslate = stripMetaLines(translate)
      const cleanedRoman = stripMetaLines(roman)

      // 翻译/音译按行索引重对齐到主轨时间戳，规避 kit 0 容差精确匹配导致的整行漏配
      const alignedTranslate = realignByIndex(cleanedOriginal, cleanedTranslate)
      const alignedRomanRaw = realignByIndex(cleanedOriginal, cleanedRoman)
      // kit LRC 对 roman 强制行级解析：必须先剥掉逐字时间标签，否则标签会原样进 content
      const syllableRoman = hasSyllableTags(alignedRomanRaw) ? alignedRomanRaw : ''
      const alignedRoman = stripSyllableTags(alignedRomanRaw)

      const pipeline = new ParserPipeline({
        content: {
          original: cleanedOriginal,
          translate: alignedTranslate,
          roman: alignedRoman
        },
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
      // 背景伴唱折回主行，避免 DOM 播放器把背景行叠在主词上
      foldBackgroundsIntoMain(result)
      // 绝对时间标签的词 end==start，补全时长供卡拉 OK / 重音
      reconstructWordDurations(result)
      // 逐字音译：用原轨音节对齐挂到 word.annotation.romans
      if (syllableRoman) {
        const ok = attachWordRomans(result, syllableRoman)
        if (!ok) {
          console.warn('[lyric] 逐字音译无法被解析，已回退为行级音译')
        }
      }

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
    setAnnotationVisible,
    relayout
  }
}
