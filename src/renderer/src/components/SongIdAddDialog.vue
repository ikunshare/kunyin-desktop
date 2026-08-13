<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import AppIcon from './AppIcon.vue'
import type { MusicItem } from '@common'
import { useLibraryStore } from '../stores/library'

/**
 * 通过平台歌曲 ID / MID 向本地歌单添加单曲。
 *
 * 行为与安卓版一致：
 * - QQ：纯数字按歌曲 ID 查询，其他输入按 MID 查询；
 * - 网易云、酷我：只接受纯数字歌曲 ID；
 * - 查询成功后直接写入当前本地歌单。
 */
const props = defineProps<{
  playlistId: number
  playlistName: string
}>()
const emit = defineEmits<{
  close: []
  added: [item: MusicItem]
}>()

type ImportSource = 'qq' | 'wy' | 'kw'

const PLATFORMS: { key: ImportSource; label: string }[] = [
  { key: 'qq', label: 'QQ 音乐' },
  { key: 'wy', label: '网易云音乐' },
  { key: 'kw', label: '酷我音乐' }
]

const library = useLibraryStore()
const platform = ref<ImportSource>('qq')
const input = ref('')
const loading = ref(false)
const error = ref('')

const hint = computed(() =>
  platform.value === 'qq' ? '输入歌曲 ID（纯数字）或 MID' : '输入歌曲 ID（纯数字）'
)
const placeholder = computed(() => (platform.value === 'qq' ? 'ID / MID' : '歌曲 ID'))

watch(platform, () => {
  input.value = ''
  error.value = ''
})

async function addSong(): Promise<void> {
  if (loading.value) return

  const value = input.value.trim()
  if (!value) {
    error.value = platform.value === 'qq' ? '请输入歌曲 ID 或 MID' : '请输入歌曲 ID'
    return
  }
  if (platform.value !== 'qq' && !/^\d+$/.test(value)) {
    error.value = '歌曲 ID 只能包含数字'
    return
  }

  loading.value = true
  error.value = ''
  try {
    const key = platform.value === 'qq' && !/^\d+$/.test(value) ? 'mid' : 'id'
    const item = await window.api.redirect.lookup(platform.value, key, value)
    if (!item) {
      error.value = '导入失败，请检查 ID 或 MID 是否正确'
      return
    }
    await library.addToPlaylist(props.playlistId, item)
    emit('added', item)
    emit('close')
  } catch {
    error.value = '导入失败，请稍后重试'
  } finally {
    loading.value = false
  }
}

function close(): void {
  if (!loading.value) emit('close')
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') close()
}

onMounted(() => document.addEventListener('keydown', onKey))
onBeforeUnmount(() => document.removeEventListener('keydown', onKey))
</script>

<template>
  <Teleport to="body">
    <div class="overlay" @click.self="close">
      <div class="card" role="dialog" aria-modal="true" aria-labelledby="song-id-add-title">
        <header class="head">
          <span id="song-id-add-title" class="head-title ellipsis"> 通过 ID / MID 添加歌曲 </span>
          <span class="head-sub ellipsis">添加到「{{ playlistName }}」</span>
        </header>

        <form class="body" @submit.prevent="addSong">
          <div class="group-label">选择歌曲平台</div>
          <div class="platforms">
            <button
              v-for="item in PLATFORMS"
              :key="item.key"
              type="button"
              class="platform"
              :class="{ active: platform === item.key }"
              :disabled="loading"
              @click="platform = item.key"
            >
              {{ item.label }}
            </button>
          </div>

          <label class="group-label" for="song-id-input">{{ hint }}</label>
          <div class="input-wrap">
            <AppIcon name="library" :size="15" />
            <input
              id="song-id-input"
              v-model="input"
              :placeholder="placeholder"
              :disabled="loading"
              autocomplete="off"
              spellcheck="false"
              autofocus
            />
          </div>
          <p v-if="error" class="error" role="alert">{{ error }}</p>

          <footer class="foot">
            <button type="button" class="btn ghost" :disabled="loading" @click="close">取消</button>
            <button type="submit" class="btn primary" :disabled="!input.trim() || loading">
              {{ loading ? '正在导入…' : '导入' }}
            </button>
          </footer>
        </form>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.28);
}
.card {
  width: 390px;
  border-radius: 8px;
  background: var(--color-main-background);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.24);
  overflow: hidden;
}
.head {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 14px;
  background: var(--color-primary-background-active);
}
.head-title {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--color-font);
}
.head-sub {
  font-size: 11.5px;
  color: var(--color-font-label);
}
.body {
  padding: 14px;
}
.group-label {
  display: block;
  margin: 0 0 7px;
  font-size: 12px;
  color: var(--color-font-label);
}
.platforms {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  margin-bottom: 15px;
}
.platform {
  padding: 7px 8px;
  border-radius: var(--form-radius);
  font-size: 12.5px;
  color: var(--color-font);
  background: var(--color-primary-background);
  transition:
    color 0.12s ease,
    background 0.12s ease;
}
.platform:hover {
  background: var(--color-primary-background-hover);
}
.platform.active {
  color: #fff;
  background: var(--color-primary);
}
.platform:disabled {
  opacity: 0.55;
}
.input-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  border-radius: 5px;
  color: var(--color-font-label);
  background: var(--color-primary-light-400-alpha-700);
}
.input-wrap:focus-within {
  box-shadow: 0 0 0 1px var(--color-primary-alpha-600);
}
.input-wrap input {
  flex: 1;
  min-width: 0;
  padding: 9px 0;
  font-size: 12.5px;
  color: var(--color-font);
  background: transparent;
}
.input-wrap input::placeholder {
  color: var(--color-font-label);
}
.error {
  margin: 8px 0 0;
  font-size: 12px;
  color: #e5484d;
}
.foot {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 18px;
}
.btn {
  min-width: 68px;
  padding: 7px 16px;
  border-radius: var(--form-radius);
  font-size: 13px;
  transition:
    background 0.15s ease,
    filter 0.15s ease;
}
.btn.ghost {
  color: var(--color-font);
  background: var(--color-primary-background);
}
.btn.ghost:hover {
  background: var(--color-primary-background-hover);
}
.btn.primary {
  color: #fff;
  background: var(--color-primary);
}
.btn.primary:hover {
  filter: brightness(1.06);
}
.btn:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
