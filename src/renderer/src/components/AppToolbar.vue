<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import AppIcon from './AppIcon.vue'
import { useSearchStore } from '../stores/search'

const router = useRouter()
const searchStore = useSearchStore()
const { keyword, history } = storeToRefs(searchStore)
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
}
</script>

<template>
  <header class="toolbar">
    <div class="search-wrap">
      <div class="search-box" :class="{ open: focused }">
        <AppIcon name="search" :size="16" />
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

      <div v-if="focused && (tips.length || (!local && history.length))" class="dropdown">
        <!-- 建议词 -->
        <template v-if="local && tips.length">
          <button v-for="t in tips" :key="t" class="dd-item" @mousedown.prevent="go(t)">
            <AppIcon name="search" :size="13" />
            <span class="dd-text ellipsis">{{ t }}</span>
          </button>
        </template>
        <!-- 历史 -->
        <template v-else-if="!local && history.length">
          <div class="dd-head">
            <span>搜索历史</span>
            <button class="dd-clear" @mousedown.prevent="searchStore.clearHistory()">清空</button>
          </div>
          <button v-for="h in history" :key="h" class="dd-item" @mousedown.prevent="go(h)">
            <AppIcon name="clock" :size="13" />
            <span class="dd-text ellipsis">{{ h }}</span>
            <button
              class="dd-del"
              title="删除"
              @mousedown.prevent.stop="searchStore.removeHistory(h)"
            >
              <AppIcon name="close" :size="11" />
            </button>
          </button>
        </template>
      </div>
    </div>
  </header>
</template>

<style scoped>
.toolbar {
  flex: none;
  height: var(--height-toolbar);
  display: flex;
  align-items: center;
  padding: 0 15px;
}
.search-wrap {
  position: relative;
  width: 300px;
}
.search-box {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border-radius: var(--form-radius);
  color: var(--color-font-label);
  background-color: var(--color-primary-background);
  transition: background-color 0.2s ease;
}
.search-box:hover,
.search-box.open {
  background-color: var(--color-primary-background-hover);
}
.search-input {
  flex: 1;
  min-width: 0;
  font-size: 13.3px;
  color: var(--color-font);
  background: none;
}
.clear {
  flex: none;
  display: flex;
  color: var(--color-font-label);
}
.clear:hover {
  color: var(--color-font);
}

.dropdown {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  right: 0;
  z-index: 50;
  max-height: 360px;
  overflow-y: auto;
  padding: 6px;
  border-radius: var(--radius-border);
  background-color: var(--color-content-background);
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.18);
}
.dd-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 8px 6px;
  font-size: 12px;
  color: var(--color-font-label);
}
.dd-clear {
  color: var(--color-font-label);
  font-size: 12px;
}
.dd-clear:hover {
  color: var(--color-primary);
}
.dd-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px;
  border-radius: var(--form-radius);
  text-align: left;
  color: var(--color-font);
  transition: background-color 0.12s ease;
}
.dd-item:hover {
  background-color: var(--color-primary-background);
}
.dd-item :deep(svg) {
  flex: none;
  color: var(--color-font-label);
}
.dd-text {
  flex: 1;
  min-width: 0;
  font-size: 13px;
}
.dd-del {
  flex: none;
  display: flex;
  color: var(--color-font-label);
  opacity: 0;
}
.dd-item:hover .dd-del {
  opacity: 1;
}
.dd-del:hover {
  color: var(--color-primary);
}
</style>
