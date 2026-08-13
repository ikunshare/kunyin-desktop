<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import AppIcon from './AppIcon.vue'
import { useSearchStore } from '../stores/search'
import { useApi } from '../composables/useApi'

const api = useApi()
const router = useRouter()
const searchStore = useSearchStore()
const { keyword } = storeToRefs(searchStore)
const local = ref('')

const focused = ref(false)
const tips = ref<string[]>([])
let tipTimer: ReturnType<typeof setTimeout> | null = null

function go(q: string): void {
  const kw = q.trim()
  if (!kw) return
  local.value = kw
  keyword.value = kw
  focused.value = false
  router.push({ name: 'search' })
  void searchStore.search()
}

function submit(): void {
  go(local.value)
}

function onInput(): void {
  if (tipTimer) clearTimeout(tipTimer)
  const q = local.value.trim()
  if (!q) {
    tips.value = []
    return
  }
  tipTimer = setTimeout(async () => {
    tips.value = await searchStore.tips(q)
  }, 250)
}

function onBlur(): void {
  // 延迟收起，保证点击下拉项能触发
  setTimeout(() => (focused.value = false), 150)
}

function clearInput(): void {
  local.value = ''
  tips.value = []
  // 彻底清除当前搜索:关键词 + 结果一并清空,搜索页回到历史/热搜
  keyword.value = ''
  searchStore.clearResults()
}
</script>

<template>
  <header class="toolbar drag">
    <div class="search-wrap no-drag">
      <div class="search-box" :class="{ open: focused }">
        <div class="form">
          <AppIcon name="search" :size="15" />
          <input
            v-model="local"
            class="search-input"
            type="text"
            placeholder="搜索歌曲、歌手、专辑"
            spellcheck="false"
            @focus="focused = true"
            @blur="onBlur"
            @input="onInput"
            @keyup.enter="submit"
          />
          <button v-if="local" class="clear" title="清空" @click="clearInput">
            <AppIcon name="close" :size="13" />
          </button>
        </div>
        <!-- 搜索提示（LX SearchInput：与输入框同盒向下展开，无独立浮层） -->
        <ul v-if="focused && local && tips.length" class="dropdown">
          <li v-for="t in tips" :key="t" class="dd-item" @mousedown.prevent="go(t)">
            <span class="ellipsis-2">{{ t }}</span>
          </li>
        </ul>
      </div>
    </div>

    <div class="win-controls no-drag">
      <button class="win-btn min" title="最小化" @click="api.window.minimize()">
        <AppIcon name="minus" :size="16" />
      </button>
      <button class="win-btn close" title="关闭" @click="api.window.close()">
        <AppIcon name="close" :size="16" />
      </button>
    </div>
  </header>
</template>

<style scoped>
.toolbar {
  flex: none;
  height: var(--height-toolbar);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 0 0 15px;
}
.search-wrap {
  position: relative;
  width: 35%;
  min-width: 240px;
  height: 30px;
}
/* LX SearchInput：搜索盒 absolute 定位，展开提示时整盒向下撑高浮于内容之上；
   低饱和主色底，聚焦/展开变浅 + 投影 */
.search-box {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 50;
  border-radius: var(--form-radius);
  color: var(--color-button-font);
  background-color: var(--color-primary-light-300-alpha-700);
  transition:
    background-color 0.2s ease,
    box-shadow 0.2s ease;
}
.search-box:hover,
.search-box.open {
  background-color: var(--color-primary-light-600-alpha-100);
  box-shadow: 0 1px 5px rgba(0, 0, 0, 0.2);
}
.form {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 30px;
  padding: 0 10px;
}
.search-input {
  flex: 1;
  min-width: 0;
  font-size: 13.5px;
  color: var(--color-font);
  background: none;
}
.search-input::placeholder {
  color: var(--color-button-font);
}
.clear {
  flex: none;
  display: flex;
  color: var(--color-font-label);
}
.clear:hover {
  color: var(--color-font);
}

/* 提示列表：在搜索盒内（同背景同圆角），行 hover 用主题深色半透明（LX .select） */
.dropdown {
  max-height: 320px;
  overflow-y: auto;
  padding: 0 0 4px;
  font-size: 13px;
}
.dd-item {
  cursor: pointer;
  padding: 8px 10px;
  line-height: 1.3;
  color: var(--color-font);
  transition: background-color 0.15s ease;
}
.dd-item:hover {
  background-color: var(--color-primary-dark-100-alpha-700);
}

/* LX 窗口按钮：46x30，hover 主题色 */
.win-controls {
  flex: none;
  display: flex;
  align-items: center;
  align-self: stretch;
}
.win-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 46px;
  height: 30px;
  color: var(--color-font-label);
  transition:
    background-color 0.2s ease,
    color 0.2s ease;
}
.win-btn:hover {
  color: #fff;
}
.win-btn.min:hover {
  background-color: var(--color-btn-min);
}
.win-btn.close:hover {
  background-color: var(--color-btn-close);
}
</style>
