<script setup lang="ts">
/**
 * 下拉选择（对应 LX 的 base-selection：自绘弹层，不用原生 select——原生弹出的是系统控件，
 * Windows 上是方角白底蓝高亮，换什么主题都配不上）。
 *
 * 弹层用 `popover="manual"` 进浏览器顶层：不被设置页等滚动容器的 overflow 裁掉，也能盖在
 * 原生模态 <dialog>（音效弹窗）之上——Teleport 到 body 反而会落在模态对话框底下变成 inert。
 * 焦点始终留在触发按钮上（键盘导航走 aria-activedescendant），所以 Esc 只收起弹层、
 * 不会顺带关掉外层对话框。
 *
 * 根元素是可见的「框」（父组件传的 class / style 落在它上面，宽高、内边距、底色照旧可覆盖），
 * id / title / aria-* 透传给里面的按钮，所以 `<label for>` 照常可用。
 */
import { computed, nextTick, onBeforeUnmount, ref, useAttrs, useId, watch } from 'vue'
import type { StyleValue } from 'vue'
import AppIcon from './AppIcon.vue'

export interface SelectOption {
  id: string | number
  label: string
  /** 分组名：相邻同组的选项归到一个组标题下（对应原生的 optgroup） */
  group?: string
}

defineOptions({ inheritAttrs: false })

const props = withDefaults(
  defineProps<{
    modelValue: string | number
    list?: SelectOption[]
    disabled?: boolean
  }>(),
  { list: () => [] }
)
/** 值一律按字符串回传（与原生 select 的 value 一致，调用方都按这个写的） */
const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>()

const attrs = useAttrs()
const rootClass = computed(() => attrs.class)
const rootStyle = computed(() => attrs.style as StyleValue)
const buttonAttrs = computed(() => {
  const { class: _class, style: _style, ...rest } = attrs
  return rest
})

const listId = `base-select-${useId()}`

const rootEl = ref<HTMLElement | null>(null)
const buttonEl = ref<HTMLButtonElement | null>(null)
const listEl = ref<HTMLElement | null>(null)
const open = ref(false)
const activeIndex = ref(-1)

/** 渲染用：组标题与选项按原顺序排开，选项带上它在 list 里的下标 */
const rows = computed(() => {
  const out: ({ kind: 'group'; label: string } | { kind: 'option'; index: number })[] = []
  let group: string | undefined
  props.list.forEach((item, index) => {
    if (item.group && item.group !== group) out.push({ kind: 'group', label: item.group })
    group = item.group
    out.push({ kind: 'option', index })
  })
  return out
})

const selectedIndex = computed(() =>
  props.list.findIndex((item) => String(item.id) === String(props.modelValue))
)
/** 值不在列表里时留空（与原生 select 一致），不把原始 id 露给用户 */
const currentLabel = computed(() => props.list[selectedIndex.value]?.label ?? '')

const optionId = (index: number): string => `${listId}-${index}`

// ---- 开合 ----

const EDGE = 8
const GAP = 4
const MAX_HEIGHT = 320

/** 按触发框定位：下方放得下（或比上方宽裕）就往下展开，否则往上 */
function place(): void {
  const root = rootEl.value
  const list = listEl.value
  if (!root || !list) return
  // #app 带 CSS zoom（界面字体大小档位），弹层继承同一缩放：量出来的是视口像素，写回要除掉
  const zoom = list.currentCSSZoom || 1
  const anchor = root.getBoundingClientRect()
  list.style.minWidth = `${anchor.width / zoom}px`
  list.style.maxWidth = `${(window.innerWidth - EDGE * 2) / zoom}px`
  list.style.maxHeight = 'none'
  const box = list.getBoundingClientRect()
  const natural = Math.min(box.height, MAX_HEIGHT * zoom)
  const below = window.innerHeight - anchor.bottom - GAP - EDGE
  const above = anchor.top - GAP - EDGE
  const down = below >= natural || below >= above
  const height = Math.min(natural, down ? below : above)
  const top = down ? anchor.bottom + GAP : anchor.top - GAP - height
  const left = Math.max(EDGE, Math.min(anchor.left, window.innerWidth - box.width - EDGE))
  list.style.maxHeight = `${height / zoom}px`
  list.style.top = `${top / zoom}px`
  list.style.left = `${left / zoom}px`
  list.dataset.side = down ? 'bottom' : 'top'
}

/**
 * 把当前项滚进弹层可视区。不用 scrollIntoView：弹层在顶层、按 fixed 定位，
 * 它会顺着祖先链去滚别的容器；这里只滚弹层自己（offsetParent 就是弹层）。
 */
function revealActive(center = false): void {
  const list = listEl.value
  const el = document.getElementById(optionId(activeIndex.value))
  if (!list || !el) return
  const top = el.offsetTop
  const bottom = top + el.offsetHeight
  const pad = 5
  if (center) list.scrollTop = top - (list.clientHeight - el.offsetHeight) / 2
  else if (top - pad < list.scrollTop) list.scrollTop = top - pad
  else if (bottom + pad > list.scrollTop + list.clientHeight)
    list.scrollTop = bottom + pad - list.clientHeight
}

function show(): void {
  if (open.value || props.disabled || !props.list.length) return
  const list = listEl.value
  if (!list) return
  open.value = true
  activeIndex.value = Math.max(0, selectedIndex.value)
  list.showPopover()
  place()
  revealActive(true)
  document.addEventListener('pointerdown', onOutside, true)
  document.addEventListener('scroll', onScroll, true)
  window.addEventListener('resize', hide)
  window.addEventListener('blur', hide)
}

function hide(): void {
  if (!open.value) return
  open.value = false
  const list = listEl.value
  if (list?.matches(':popover-open')) list.hidePopover()
  document.removeEventListener('pointerdown', onOutside, true)
  document.removeEventListener('scroll', onScroll, true)
  window.removeEventListener('resize', hide)
  window.removeEventListener('blur', hide)
}

function toggle(): void {
  if (open.value) hide()
  else show()
  buttonEl.value?.focus()
}

function onOutside(e: PointerEvent): void {
  const target = e.target as Node
  if (rootEl.value?.contains(target) || listEl.value?.contains(target)) return
  hide()
}

/** 外面的页面一滚，触发框就跑了；弹层自己滚不算 */
function onScroll(e: Event): void {
  if (e.target !== listEl.value) hide()
}

function choose(index: number): void {
  const item = props.list[index]
  hide()
  buttonEl.value?.focus()
  if (item && index !== selectedIndex.value) emit('update:modelValue', String(item.id))
}

// ---- 键盘 ----

let typed = ''
let typedTimer: ReturnType<typeof setTimeout> | undefined

/** 键入字符跳到以它开头的选项（与原生 select 一样，连续键入按整串匹配） */
function typeAhead(char: string): void {
  clearTimeout(typedTimer)
  typedTimer = setTimeout(() => (typed = ''), 600)
  typed += char.toLowerCase()
  const count = props.list.length
  const from = open.value ? activeIndex.value : selectedIndex.value
  const start = typed.length === 1 ? from + 1 : Math.max(0, from)
  for (let i = 0; i < count; i++) {
    const index = (start + i) % count
    if (props.list[index].label.toLowerCase().startsWith(typed)) {
      if (open.value) {
        activeIndex.value = index
        void nextTick(() => revealActive())
      } else if (index !== selectedIndex.value) {
        emit('update:modelValue', String(props.list[index].id))
      }
      return
    }
  }
}

function move(to: number): void {
  const last = props.list.length - 1
  activeIndex.value = Math.max(0, Math.min(last, to))
  void nextTick(() => revealActive())
}

function onKeydown(e: KeyboardEvent): void {
  if (props.disabled) return
  if (!open.value) {
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
      e.preventDefault()
      show()
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      typeAhead(e.key)
    }
    return
  }
  const page = 8
  switch (e.key) {
    case 'ArrowDown':
      move(activeIndex.value + 1)
      break
    case 'ArrowUp':
      move(activeIndex.value - 1)
      break
    case 'PageDown':
      move(activeIndex.value + page)
      break
    case 'PageUp':
      move(activeIndex.value - page)
      break
    case 'Home':
      move(0)
      break
    case 'End':
      move(props.list.length - 1)
      break
    case 'Enter':
    case ' ':
      if (typed && e.key === ' ') {
        typeAhead(' ')
        break
      }
      choose(activeIndex.value)
      break
    case 'Escape':
      // 吞掉这次 Esc：外层原生 <dialog> 的关闭请求就不会再被触发
      e.stopPropagation()
      hide()
      break
    case 'Tab':
      hide()
      return
    default:
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) typeAhead(e.key)
      else return
  }
  e.preventDefault()
}

watch(
  () => props.disabled,
  (disabled) => disabled && hide()
)
watch(
  () => props.list,
  () => open.value && void nextTick(place)
)
onBeforeUnmount(() => {
  hide()
  clearTimeout(typedTimer)
})
</script>

<template>
  <div
    ref="rootEl"
    class="selection"
    :class="[rootClass, { open, disabled }]"
    :style="rootStyle"
    @mousedown.prevent
    @click="toggle"
  >
    <button
      ref="buttonEl"
      v-bind="buttonAttrs"
      type="button"
      class="trigger"
      role="combobox"
      aria-haspopup="listbox"
      :aria-expanded="open"
      :aria-controls="listId"
      :aria-activedescendant="open && activeIndex >= 0 ? optionId(activeIndex) : undefined"
      :disabled="disabled"
      @keydown="onKeydown"
      @blur="hide"
    >
      <!-- 所有选项叠在同一格里撑宽度：框宽 = 最长的选项（同原生 select），换选项不跳动 -->
      <span class="value-box">
        <span class="value">{{ currentLabel }}</span>
        <span v-for="item in list" :key="item.id" class="sizer" aria-hidden="true">{{
          item.label
        }}</span>
      </span>
    </button>
    <AppIcon name="chevron-down" :size="14" class="arrow" />

    <div
      :id="listId"
      ref="listEl"
      popover="manual"
      class="select-list scroll"
      role="listbox"
      @click.stop
    >
      <template v-for="(row, i) in rows" :key="i">
        <div v-if="row.kind === 'group'" class="group" role="presentation">{{ row.label }}</div>
        <div
          v-else
          :id="optionId(row.index)"
          class="option"
          :class="{ active: row.index === activeIndex, selected: row.index === selectedIndex }"
          role="option"
          :aria-selected="row.index === selectedIndex"
          @pointermove="activeIndex = row.index"
          @click="choose(row.index)"
        >
          <span class="option-label">{{ list[row.index].label }}</span>
          <AppIcon v-if="row.index === selectedIndex" name="check" :size="14" class="check" />
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.selection {
  position: relative;
  display: inline-flex;
  align-items: center;
  box-sizing: border-box;
  min-width: 180px;
  max-width: 100%;
  height: 36px;
  padding: 0 34px 0 12px;
  border: 1px solid var(--color-primary-alpha-900);
  border-radius: 8px;
  background-color: color-mix(in srgb, var(--color-main-background) 88%, var(--color-primary) 12%);
  color: var(--color-font);
  font-size: 12px;
  vertical-align: middle;
  cursor: pointer;
  transition:
    border-color 0.2s ease,
    box-shadow 0.2s ease,
    background-color 0.2s ease;
}
.selection:hover {
  background-color: var(--color-primary-background-hover);
  border-color: var(--color-primary-alpha-700);
}
.selection.open,
.selection:has(.trigger:focus-visible) {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 3px var(--color-primary-alpha-800);
}
.selection.disabled {
  opacity: 0.5;
  cursor: default;
  pointer-events: none;
}
.trigger {
  flex: 1;
  min-width: 0;
  height: 100%;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: inherit;
  outline: none;
}
.value-box {
  display: grid;
  min-width: 0;
}
.value-box > span {
  grid-area: 1 / 1;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.sizer {
  height: 0;
  visibility: hidden;
}
.arrow {
  position: absolute;
  right: 10px;
  top: 50%;
  margin-top: -7px;
  color: var(--color-font-label);
  pointer-events: none;
  transition:
    transform 0.2s ease,
    color 0.2s ease;
}
.selection:hover .arrow,
.selection.open .arrow {
  color: var(--color-primary);
}
.selection.open .arrow {
  transform: rotate(180deg);
}

/* ---- 弹层（视觉对齐 ContextMenu） ---- */
.select-list {
  position: fixed;
  inset: auto;
  margin: 0;
  box-sizing: border-box;
  width: max-content;
  padding: 5px;
  overflow-x: hidden;
  overflow-y: auto;
  border-radius: 8px;
  border: 1px solid var(--color-primary-light-100-alpha-700);
  background: var(--color-content-background);
  color: var(--color-font);
  font-size: 13px;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.16);
  overscroll-behavior: contain;
  cursor: default;
}
.select-list:popover-open {
  animation: select-in 0.12s ease-out;
}
.select-list[data-side='top']:popover-open {
  animation-name: select-in-up;
}
@keyframes select-in {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
}
@keyframes select-in-up {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
}
.group {
  padding: 8px 10px 4px;
  color: var(--color-font-label);
  font-size: 11px;
  font-weight: 600;
  pointer-events: none;
}
.group:first-child {
  padding-top: 4px;
}
.option {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 32px;
  padding: 0 10px;
  border-radius: 5px;
  cursor: pointer;
}
.option.active {
  background: var(--color-primary-background-hover);
}
.option.selected {
  color: var(--color-primary);
  font-weight: 600;
}
.option-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.check {
  flex: none;
}
</style>
