import { onMounted, onUnmounted } from 'vue'

const ENTER_CLASSES = [
  'popup-enter-zoom',
  'popup-enter-slide',
  'popup-enter-flip',
  'popup-enter-drop'
] as const
const POPUP_ROOT_SELECTOR = '.mask, .overlay, .mv-mask'

/**
 * 为各处独立实现的弹出层统一补上 LX 风格入场动画，不要求重写现有 Dialog 组件。
 * DOM 新增时读取最新设置，因此修改开关后下一次打开弹层立即生效。
 */
export function usePopupAnimation(
  isAnimationEnabled: () => boolean,
  isRandomEnabled: () => boolean
): void {
  let observer: MutationObserver | null = null

  const animate = (root: Element): void => {
    if (!isAnimationEnabled()) return
    const content = root.firstElementChild
    if (!(content instanceof HTMLElement)) return

    const index = isRandomEnabled() ? Math.floor(Math.random() * ENTER_CLASSES.length) : 0
    const className = ENTER_CLASSES[index]
    content.classList.remove(...ENTER_CLASSES)
    // 同一节点若被复用，强制建立新的动画时间线。
    void content.offsetWidth
    content.classList.add(className)
    content.addEventListener('animationend', () => content.classList.remove(className), {
      once: true
    })
  }

  const scan = (node: Node): void => {
    if (!(node instanceof Element)) return
    if (node.matches(POPUP_ROOT_SELECTOR)) animate(node)
    node.querySelectorAll(POPUP_ROOT_SELECTOR).forEach(animate)
  }

  onMounted(() => {
    observer = new MutationObserver((records) => {
      for (const record of records) record.addedNodes.forEach(scan)
    })
    observer.observe(document.body, { childList: true, subtree: true })
  })

  onUnmounted(() => observer?.disconnect())
}
