<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import AppIcon from './AppIcon.vue'
import type { KgLyricCandidate, KugouMusicItem, MusicItem } from '@common'
import { coverUrl } from '../utils/cover'

/**
 * 歌词/封面重定向对话框（移植安卓 SongRedirectDialog）。
 *
 * QQ / 网易云 / 酷我：输入 id（QQ 另支持 mid）→ 查询 → 预览卡 → 保存（歌词 + 封面一起重定向）。
 * 酷狗：输入关键词 → 搜索歌词候选（带逐字/翻译等类型徽标）→ 挑选 → 保存（仅歌词，
 *       accesskey + download_id 直链，见 kg/lyric.ts getKgLyric 的直链分支）。
 */
const props = defineProps<{ item: MusicItem }>()
const emit = defineEmits<{ close: [] }>()

const PLATFORMS: { key: 'qq' | 'wy' | 'kg' | 'kw'; label: string }[] = [
  { key: 'qq', label: 'QQ 音乐' },
  { key: 'wy', label: '网易云' },
  { key: 'kg', label: '酷狗' },
  { key: 'kw', label: '酷我' }
]

const platform = ref<'qq' | 'wy' | 'kg' | 'kw'>('qq')
const qqUseMid = ref(false)
const input = ref('')
const kgKeyword = ref(`${props.item.artist} - ${props.item.title}`.replace(/^[\s-]+|[\s-]+$/g, ''))
const loading = ref(false)
const error = ref('')
const preview = ref<MusicItem | null>(null)
const kgCandidates = ref<KgLyricCandidate[]>([])
const kgSelected = ref<KgLyricCandidate | null>(null)
const current = ref<MusicItem | null>(null)
const busy = ref(false)

const isKg = computed(() => platform.value === 'kg')
const canSave = computed(() => (isKg.value ? !!kgSelected.value : !!preview.value))

const inputLabel = computed(() => {
  if (platform.value === 'qq') return qqUseMid.value ? '歌曲 mid' : '歌曲数字 id'
  if (platform.value === 'wy') return '网易云歌曲 id'
  return '酷我歌曲 id'
})

// 切平台/切 QQ 键类型：清空查询状态（对齐安卓 LaunchedEffect）
watch([platform, qqUseMid], () => {
  preview.value = null
  error.value = ''
  kgCandidates.value = []
  kgSelected.value = null
})

async function lookup(): Promise<void> {
  error.value = ''
  if (loading.value) return
  if (isKg.value) {
    const kw = kgKeyword.value.trim()
    if (!kw) {
      error.value = '请输入关键词'
      return
    }
    kgCandidates.value = []
    kgSelected.value = null
    loading.value = true
    try {
      const res = await window.api.redirect.kgSearch(kw, props.item.duration)
      if (!res.length) error.value = '没有找到候选歌词'
      else kgCandidates.value = res
    } catch {
      error.value = '搜索失败'
    } finally {
      loading.value = false
    }
  } else {
    const v = input.value.trim()
    if (!v) {
      error.value = '请输入 id'
      return
    }
    preview.value = null
    loading.value = true
    try {
      // 此分支 platform 必非 'kg'（isKg 已分流），TS 无法从 computed 收窄，手动断言
      const source = platform.value as 'qq' | 'wy' | 'kw'
      const key = platform.value === 'qq' && qqUseMid.value ? 'mid' : 'id'
      const res = await window.api.redirect.lookup(source, key, v)
      if (!res) error.value = '查不到这首歌'
      else preview.value = res
    } catch {
      error.value = '查询失败'
    } finally {
      loading.value = false
    }
  }
}

/** 选中的酷狗候选 → 可保存的目标（对齐安卓 kgBuildTarget；直链字段是关键） */
function buildKgTarget(c: KgLyricCandidate): KugouMusicItem {
  return {
    type: 'kg',
    id: 0,
    title: c.song || props.item.title,
    artist: c.singer || props.item.artist,
    album: '',
    cover: '',
    duration: c.durationMs,
    qualities: {},
    hash: '',
    lyricAccessKey: c.accessKey,
    lyricDownloadId: c.downloadId
  }
}

function plain<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}

async function save(): Promise<void> {
  if (busy.value || !canSave.value) return
  const target = isKg.value ? buildKgTarget(kgSelected.value!) : preview.value!
  busy.value = true
  try {
    await window.api.library.setRedirect(plain(props.item), plain(target))
    emit('close')
  } finally {
    busy.value = false
  }
}

async function clear(): Promise<void> {
  if (busy.value) return
  busy.value = true
  try {
    await window.api.library.clearRedirect(plain(props.item))
    emit('close')
  } finally {
    busy.value = false
  }
}

function fmt(ms: number): string {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') emit('close')
}
onMounted(() => {
  document.addEventListener('keydown', onKey)
  void window.api.library
    .getRedirect(plain(props.item))
    .then((r) => (current.value = r))
    .catch(() => {})
})
onBeforeUnmount(() => document.removeEventListener('keydown', onKey))
</script>

<template>
  <Teleport to="body">
    <div class="overlay" @click.self="emit('close')">
      <div class="card" role="dialog" aria-modal="true">
        <header class="head">
          <span class="head-title ellipsis">歌词重定向 · {{ item.title }}</span>
        </header>

        <div class="body scroll">
          <p class="hint">歌词与封面将改用目标歌曲的（酷狗候选仅重定向歌词）。</p>
          <p v-if="current" class="current">
            当前重定向：{{ current.title }} - {{ current.artist }}
          </p>

          <div class="group-label">目标平台</div>
          <div class="opts">
            <button
              v-for="p in PLATFORMS"
              :key="p.key"
              class="opt"
              :class="{ on: platform === p.key }"
              @click="platform = p.key"
            >
              {{ p.label }}
            </button>
          </div>

          <div v-if="platform === 'qq'" class="opts">
            <button class="opt small" :class="{ on: !qqUseMid }" @click="qqUseMid = false">
              用数字 id
            </button>
            <button class="opt small" :class="{ on: qqUseMid }" @click="qqUseMid = true">
              用 mid
            </button>
          </div>

          <div class="input-row">
            <input
              v-if="isKg"
              v-model="kgKeyword"
              :placeholder="'关键词（歌手 - 歌名）'"
              @keyup.enter="lookup"
            />
            <input v-else v-model="input" :placeholder="inputLabel" @keyup.enter="lookup" />
            <button class="btn primary sm" :disabled="loading" @click="lookup">
              {{ loading ? '查询中…' : isKg ? '搜索' : '查询' }}
            </button>
          </div>
          <p v-if="error" class="error">{{ error }}</p>

          <!-- 酷狗：候选列表挑选 -->
          <div v-if="isKg && kgCandidates.length" class="cands scroll">
            <button
              v-for="(c, i) in kgCandidates"
              :key="`${c.accessKey}_${c.downloadId}_${i}`"
              class="cand"
              :class="{ on: kgSelected === c }"
              @click="kgSelected = c"
            >
              <div class="cand-main">
                <span class="cand-title ellipsis">{{ c.song || '(无标题)' }}</span>
                <span class="cand-sub ellipsis">
                  {{ c.singer || '(未知)' }}
                  <template v-if="c.language"> · {{ c.language }}</template>
                  · {{ fmt(c.durationMs) }}
                </span>
                <div v-if="c.typeBadges.length" class="badges">
                  <span v-for="b in c.typeBadges" :key="b" class="badge">{{ b }}</span>
                </div>
              </div>
              <AppIcon v-if="kgSelected === c" name="check" :size="15" class="cand-check" />
            </button>
          </div>

          <!-- 非酷狗：预览卡 -->
          <div v-if="!isKg && preview" class="preview">
            <img v-if="preview.cover" :src="coverUrl(preview.cover)" class="pv-cover" alt="" />
            <div v-else class="pv-cover pv-empty"><AppIcon name="library" :size="18" /></div>
            <div class="pv-info">
              <div class="pv-title ellipsis">{{ preview.title || '(无标题)' }}</div>
              <div class="pv-artist ellipsis">{{ preview.artist || '(未知)' }}</div>
            </div>
          </div>
        </div>

        <footer class="foot">
          <button v-if="current" class="btn danger" :disabled="busy" @click="clear">
            清除重定向
          </button>
          <span class="spacer" />
          <button class="btn ghost" @click="emit('close')">取消</button>
          <button class="btn primary" :disabled="!canSave || busy" @click="save">保存</button>
        </footer>
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
  display: flex;
  flex-direction: column;
  width: 430px;
  max-height: 74vh;
  border-radius: 8px;
  background: var(--color-main-background);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.24);
  overflow: hidden;
}
.head {
  flex: none;
  padding: 10px 14px;
  background: var(--color-primary-background-active);
}
.head-title {
  display: block;
  font-size: 13.5px;
  font-weight: 600;
  color: var(--color-font);
}
.body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 12px 14px 6px;
}
.hint {
  margin: 0 0 6px;
  font-size: 12px;
  color: var(--color-font-label);
}
.current {
  margin: 0 0 6px;
  font-size: 12px;
  color: var(--color-primary-font);
}
.group-label {
  margin: 8px 0 6px;
  font-size: 12px;
  color: var(--color-font-label);
}
.opts {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 10px;
}
.opt {
  padding: 6px 12px;
  border-radius: var(--form-radius);
  font-size: 12.5px;
  color: var(--color-font);
  background: var(--color-primary-background);
  transition:
    background 0.12s ease,
    color 0.12s ease;
}
.opt.small {
  padding: 4px 10px;
  font-size: 12px;
}
.opt:hover {
  background: var(--color-primary-background-hover);
}
.opt.on {
  color: #fff;
  background: var(--color-primary);
}
.input-row {
  display: flex;
  gap: 8px;
}
.input-row input {
  flex: 1;
  min-width: 0;
  padding: 8px 10px;
  border-radius: 5px;
  font-size: 12.5px;
  background: var(--color-primary-light-400-alpha-700);
  color: var(--color-font);
}
.error {
  margin: 8px 0 0;
  font-size: 12px;
  color: #e5484d;
}
.cands {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 240px;
  overflow-y: auto;
  margin-top: 12px;
}
.cand {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 10px;
  border-radius: 6px;
  text-align: left;
  background: var(--color-primary-background);
  transition: background 0.12s ease;
}
.cand:hover {
  background: var(--color-primary-background-hover);
}
.cand.on {
  background: var(--color-primary-background-active);
}
.cand-main {
  flex: 1;
  min-width: 0;
}
.cand-title {
  display: block;
  font-size: 12.5px;
  font-weight: 500;
  color: var(--color-font);
}
.cand-sub {
  display: block;
  margin-top: 2px;
  font-size: 11.5px;
  color: var(--color-font-label);
}
.badges {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 4px;
}
.badge {
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 10.5px;
  color: var(--color-primary-font);
  background: var(--color-primary-light-100-alpha-600);
}
.cand-check {
  flex: none;
  color: var(--color-primary);
}
.preview {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 12px;
  padding: 8px 10px;
  border-radius: 6px;
  background: var(--color-primary-background);
}
.pv-cover {
  flex: none;
  width: 46px;
  height: 46px;
  border-radius: 6px;
  object-fit: cover;
}
.pv-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-font-label);
  background: var(--color-primary-light-100-alpha-600);
}
.pv-info {
  flex: 1;
  min-width: 0;
}
.pv-title {
  font-size: 12.5px;
  font-weight: 500;
  color: var(--color-font);
}
.pv-artist {
  margin-top: 2px;
  font-size: 11.5px;
  color: var(--color-font-label);
}
.foot {
  flex: none;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px 14px;
}
.spacer {
  flex: 1;
}
.btn {
  padding: 7px 16px;
  border-radius: var(--form-radius);
  font-size: 13px;
  transition: background 0.15s ease;
}
.btn.sm {
  flex: none;
  padding: 0 14px;
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
.btn.primary:disabled {
  opacity: 0.5;
}
.btn.danger {
  color: #e5484d;
  background: rgba(229, 72, 77, 0.1);
}
.btn.danger:hover {
  background: rgba(229, 72, 77, 0.18);
}
</style>
