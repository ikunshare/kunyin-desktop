import { Event } from '../../../utils'
import { ComponentContext } from '../context'

import { PlayerRole, PlayerState } from '../../constants'

import { applyClassName, applyRole, buildRootVariableKey } from '../../utils'

import styles from './index.module.scss'

const CONTAINER_WIDTH_KEY = buildRootVariableKey('container-width')
const CONTAINER_HEIGHT_KEY = buildRootVariableKey('container-height')

export interface ContainerEventMap {
  changeVisible: (visible: boolean) => void
  changeSize: (width: number, height: number) => void
  scroll: (event: globalThis.Event) => void
  wheel: (event: WheelEvent) => void
}

export class Container {
  readonly event: Event<ContainerEventMap> = new Event()

  private readonly dom: HTMLDivElement
  /**
   * [vendor patch] 歌词末尾的附注区（制作人信息）宿主。
   * 常驻元素：clearChild 重建歌词行时不会被清掉；位置由 LayoutManager 排在最后一行之后，
   * 因此能与歌词一起滚动，而不是浮在面板底部的独立区块。
   */
  private readonly footerDom: HTMLDivElement
  private readonly resizeObserver: ResizeObserver
  private readonly intersectionObserver: IntersectionObserver

  private size: { width: number; height: number }
  private isVisible: boolean

  constructor(
    private readonly context: ComponentContext,
    host: HTMLElement
  ) {
    this.size = { width: 0, height: 0 }
    this.isVisible = false

    this.dom = document.createElement('div')
    applyRole(this.dom, PlayerRole.container)

    this.footerDom = document.createElement('div')
    applyRole(this.footerDom, PlayerRole.footer)
    applyClassName(this.footerDom, [styles.footer])
    this.dom.appendChild(this.footerDom)

    this.resizeObserver = new ResizeObserver(this.handleResize)
    this.intersectionObserver = new IntersectionObserver(this.handleIntersection)

    this.resizeObserver.observe(this.dom)
    this.intersectionObserver.observe(this.dom)

    this.dom.addEventListener('scroll', this.handleScroll, { passive: false })
    this.dom.addEventListener('wheel', this.handleWheel, { passive: false })

    host.appendChild(this.dom)

    this.updateConfig()
  }

  private handleIntersection = (entries: IntersectionObserverEntry[]) => {
    const visible = entries[0]?.isIntersecting ?? false
    if (this.isVisible === visible) {
      return
    }

    this.isVisible = visible
    this.event.emit('changeVisible', visible)
  }

  private handleResize = (entries: ResizeObserverEntry[]) => {
    const entry = entries[0]
    if (!entry) {
      return
    }

    const { width, height } = entry.contentRect
    if (this.size.width === width && this.size.height === height) {
      return
    }

    this.size = { width, height }
    this.event.emit('changeSize', width, height)

    const domStyle = this.dom.style
    domStyle.setProperty(CONTAINER_WIDTH_KEY, `${width}px`)
    domStyle.setProperty(CONTAINER_HEIGHT_KEY, `${height}px`)
  }

  private handleScroll = (e: globalThis.Event) => {
    this.event.emit('scroll', e)
  }

  private handleWheel = (e: WheelEvent) => {
    this.event.emit('wheel', e)
  }

  updateConfig() {
    applyClassName(this.dom, [styles.container, this.context.config.container.className])

    if (this.context.config.container.fade.enabled) {
      this.dom.setAttribute(PlayerState.container.enableFade, '')
    } else {
      this.dom.removeAttribute(PlayerState.container.enableFade)
    }
  }

  setAttribute(name: string, value?: string) {
    this.dom.setAttribute(name, value || '')
  }

  removeAttribute(name: string) {
    this.dom.removeAttribute(name)
  }

  appendChild(child: HTMLDivElement) {
    this.dom.appendChild(child)
  }

  clearChild() {
    // [vendor patch] footer 是常驻附注区，重建歌词行时不能被一并清掉
    this.dom.replaceChildren(this.footerDom)
  }

  /**
   * [vendor patch] 由 LayoutManager 调用，把附注区排到最后一行之后。
   * transform / transition 与行元素同款，滚动时与歌词同步位移。
   */
  updateFooterStyle(top: number, duration: number, delay: number, easing: string) {
    const style = this.footerDom.style
    style.transition = `transform ${Math.max(0, duration)}ms ${easing} ${Math.max(0, delay)}ms`
    style.transform = `translateY(${top}px)`
    // 必须显式写 'visible'：样式表里 .footer 默认 visibility:hidden（首帧未定位时别糊在容器顶部），
    // 置空只是删掉 inline 声明、会回落到那条 hidden，元素就永远看不见。
    style.visibility = 'visible'
  }

  /** [vendor patch] 附注区无内容时收起（换到没有制作人信息的歌时复位） */
  hideFooter() {
    this.footerDom.style.visibility = 'hidden'
  }

  /** [vendor patch] 附注区实测高度（0 表示没有内容，此时无需参与布局） */
  get footerHeight() {
    return this.footerDom.offsetHeight
  }

  /** [vendor patch] 附注区宿主，交给业务侧填内容 */
  get footer() {
    return this.footerDom
  }

  destroy() {
    this.event.clear()

    this.resizeObserver.disconnect()
    this.intersectionObserver.disconnect()

    this.dom.removeEventListener('scroll', this.handleScroll)
    this.dom.removeEventListener('wheel', this.handleWheel)

    this.dom.remove()
  }

  get width() {
    return this.size.width
  }

  get height() {
    return this.size.height
  }

  get visible() {
    return this.isVisible
  }

  get element() {
    return this.dom
  }
}
