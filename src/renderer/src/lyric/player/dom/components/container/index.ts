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
    this.dom.replaceChildren()
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
