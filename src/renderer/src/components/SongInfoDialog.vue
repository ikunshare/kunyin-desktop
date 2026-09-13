<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from 'vue'
import type { MusicItem } from '@common'
import BaseBtn from './BaseBtn.vue'
import { buildSongInfoGroups, buildSongInfoText, buildSongInfoJson } from '../utils/songIdentity'
const props = defineProps<{ item: MusicItem }>()
const emit = defineEmits<{ close: [] }>()
const groups = computed(() => buildSongInfoGroups(props.item))
const tip = ref('')
const card = ref<HTMLElement | null>(null)
let previous: HTMLElement | null = null
async function copy(value: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value)
    tip.value = '已复制'
  } catch {
    tip.value = '复制失败，可选中文字手动复制'
  }
}
function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.stopPropagation()
    emit('close')
  }
  if (e.key === 'Tab') {
    const buttons = card.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')
    if (!buttons?.length) return
    const first = buttons[0],
      last = buttons[buttons.length - 1]
    if (e.shiftKey && (document.activeElement === first || document.activeElement === card.value)) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }
}
onMounted(() => {
  previous = document.activeElement as HTMLElement
  card.value?.focus()
})
onBeforeUnmount(() => previous?.focus())
</script>
<template>
  <Teleport to="body">
    <div class="overlay" @click.stop.self="emit('close')" @dblclick.stop @contextmenu.stop>
      <section
        ref="card"
        class="card"
        role="dialog"
        aria-modal="true"
        aria-label="歌曲信息"
        tabindex="-1"
        @click.stop
        @keydown="onKey"
      >
        <header>
          <h3>歌曲信息 · {{ item.title }}</h3>
          <BaseBtn min @click="emit('close')">关闭</BaseBtn>
        </header>
        <p class="hint">
          展示当前歌曲对象中已有字段，不补造平台标识。album 为专辑名；完整 JSON
          包含空值。链接及本地路径可能涉及隐私，分享前请检查。
        </p>
        <div class="body scroll">
          <section v-for="group in groups" :key="group.title">
            <h4>{{ group.title }}</h4>
            <div v-for="field in group.fields" :key="field.key" class="field">
              <span class="key">{{ field.label }}</span
              ><span class="value">{{ field.value }}</span>
              <BaseBtn
                min
                :aria-label="`复制 ${field.key}`"
                @click="copy(field.copy ?? field.value)"
                >复制</BaseBtn
              >
            </div>
          </section>
        </div>
        <footer>
          <BaseBtn min @click="copy(buildSongInfoText(item))">复制全部文本</BaseBtn
          ><BaseBtn min @click="copy(buildSongInfoJson(item))">复制完整 JSON</BaseBtn
          ><span role="status">{{ tip }}</span>
        </footer>
      </section>
    </div>
  </Teleport>
</template>
<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  z-index: 210;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.28);
  color: var(--color-font);
}
.card {
  width: min(720px, 90vw);
  max-height: 82vh;
  display: flex;
  flex-direction: column;
  border-radius: 8px;
  background: var(--color-main-background);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.24);
  padding: 20px;
  outline: none;
}
header,
footer {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
header h3 {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}
.hint {
  color: var(--color-font-label);
  font-size: 12px;
  margin: 12px 0;
}
.body {
  overflow: auto;
  min-height: 0;
  user-select: text;
}
h4 {
  margin: 12px 0;
}
.field {
  display: grid;
  grid-template-columns: minmax(100px, 1fr) minmax(0, 2fr) auto;
  align-items: center;
  gap: 12px;
  padding: 8px 0;
  border-bottom: 1px solid var(--color-primary-alpha-900);
  font-size: 12px;
}
.key,
.value {
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
.key {
  color: var(--color-font-label);
}
footer {
  margin-top: 16px;
  font-size: 12px;
}
</style>
