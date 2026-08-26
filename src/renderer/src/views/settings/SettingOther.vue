<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useApi } from '../../composables/useApi'
import { useSettingsStore } from '../../stores/settings'
import type { AccountProvider, AccountStatus, AuthState, CacheKind, CacheStats } from '@common'
import AccountLoginDialog from '../../components/AccountLoginDialog.vue'
import BaseBtn from '../../components/BaseBtn.vue'
import BaseSelect from '../../components/BaseSelect.vue'

// 其他设置：平台账号登录管理 + 卡密激活
const api = useApi()

// —— 平台账号 ——
const accounts = ref<AccountStatus[]>([])
const loginProvider = ref<AccountProvider | null>(null)
let accountUnsub: (() => void) | null = null

async function loadAccounts(): Promise<void> {
  accounts.value = await api.account.list()
}
async function logout(provider: AccountProvider): Promise<void> {
  await api.account.logout(provider)
  await loadAccounts()
}
function onLoginDone(): void {
  loginProvider.value = null
  void loadAccounts()
}

onMounted(() => {
  void loadAccounts()
  accountUnsub = api.account.onChange(() => void loadAccounts())
})
onUnmounted(() => accountUnsub?.())

// —— 卡密激活 ——
const authInput = ref('')
const authState = ref<AuthState>({ authst: '', isValid: false, message: '' })
const authBusy = ref(false)

onMounted(async () => {
  authState.value = await api.auth.get()
  authInput.value = authState.value.authst
})

async function validateAuth(): Promise<void> {
  const v = authInput.value.trim()
  if (!v || authBusy.value) return
  authBusy.value = true
  try {
    authState.value = await api.auth.validate(v)
  } finally {
    authBusy.value = false
  }
}
async function clearAuth(): Promise<void> {
  authState.value = await api.auth.clear()
  authInput.value = ''
}

// —— 缓存管理 ——
const cache = ref<CacheStats | null>(null)
/** 正在清理的类型（禁用按钮防连点，清理大缓存时耗时可感知） */
const clearing = ref<CacheKind | null>(null)

function fmtSize(bytes: number): string {
  if (bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const v = bytes / 1024 ** i
  return `${i === 0 ? v : v.toFixed(2)} ${units[i]}`
}

onMounted(async () => {
  cache.value = await api.cache.stats().catch(() => null)
})

async function clearCache(kind: CacheKind): Promise<void> {
  if (clearing.value) return
  clearing.value = kind
  try {
    cache.value = await api.cache.clear(kind)
  } finally {
    clearing.value = null
  }
}

// —— 音频缓存 ——
const settingsStore = useSettingsStore()
const { settings } = storeToRefs(settingsStore)

const GIB = 1024 ** 3
const audioLimitList = [
  { id: 0, label: '关闭（不缓存音频）' },
  { id: 1 * GIB, label: '1 GB' },
  { id: 2 * GIB, label: '2 GB' },
  { id: 4 * GIB, label: '4 GB' },
  { id: 8 * GIB, label: '8 GB' },
  { id: 16 * GIB, label: '16 GB' },
  { id: 32 * GIB, label: '32 GB' }
]
const audioLimit = computed(() => settings.value.player.audioCacheBytes)

async function setAudioLimit(value: string): Promise<void> {
  await settingsStore.update({ player: { audioCacheBytes: Number(value) } })
  // 调小上限会当即淘汰，用量得跟着刷新
  cache.value = await api.cache.stats().catch(() => cache.value)
}
</script>

<template>
  <dt id="other">其他设置</dt>
  <dd>
    <h3 id="other_account">平台账号</h3>
    <div>
      <div v-for="acc in accounts" :key="acc.provider" class="p account-row">
        <span class="acc-name">{{ acc.displayName }}</span>
        <span class="acc-status" :class="{ ok: acc.loggedIn }">
          {{ acc.loggedIn ? acc.nickname || '已登录' : '未登录' }}
        </span>
        <BaseBtn v-if="acc.loggedIn" min @click="logout(acc.provider)">退出</BaseBtn>
        <BaseBtn v-else min class="primary" @click="loginProvider = acc.provider">登录</BaseBtn>
      </div>
    </div>
  </dd>
  <dd>
    <h3 id="other_auth">卡密</h3>
    <div>
      <p class="p">
        当前状态：
        <span class="auth-status" :class="{ ok: authState.isValid }">
          {{ authState.isValid ? '已激活' : '未激活' }}
        </span>
      </p>
      <div class="gap-top auth-form">
        <input
          v-model="authInput"
          class="text"
          type="text"
          placeholder="输入卡密以解锁 QQ / 酷狗及无损音质"
          spellcheck="false"
          @keyup.enter="validateAuth"
        />
        <BaseBtn min class="primary" :disabled="authBusy" @click="validateAuth">
          {{ authBusy ? '校验中…' : '激活' }}
        </BaseBtn>
        <BaseBtn v-if="authState.authst" min @click="clearAuth">清除</BaseBtn>
      </div>
      <p v-if="authState.message" class="auth-msg" :class="{ ok: authState.isValid }">
        {{ authState.message }}
      </p>
    </div>
  </dd>

  <dd>
    <h3 id="other_cache" title="封面等图片由浏览器内核自动缓存，清理后会重新联网获取">
      资源缓存管理
    </h3>
    <div>
      <p class="p">软件已使用缓存大小：{{ cache ? fmtSize(cache.resourceBytes) : '统计中…' }}</p>
      <div class="p gap-top">
        <BaseBtn min :disabled="clearing === 'resource'" @click="clearCache('resource')">
          {{ clearing === 'resource' ? '清理中…' : '清理资源缓存' }}
        </BaseBtn>
      </div>
    </div>

    <h3 id="other_cache_audio" title="完整听过的歌会存到本地，重听时不再联网下载">音频缓存管理</h3>
    <div>
      <p class="p">
        已缓存：{{ cache ? `${fmtSize(cache.audioBytes)}（${cache.audioCount} 首）` : '统计中…' }}
      </p>
      <div class="p gap-top cache-row">
        <span class="cache-label">容量上限</span>
        <BaseSelect
          :model-value="audioLimit"
          :list="audioLimitList"
          @update:model-value="setAudioLimit"
        />
      </div>
      <div class="p gap-top">
        <BaseBtn min :disabled="clearing === 'audio'" @click="clearCache('audio')">
          {{ clearing === 'audio' ? '清理中…' : '清理音频缓存' }}
        </BaseBtn>
      </div>
    </div>

    <h3 id="other_cache_other">其他缓存管理</h3>
    <div>
      <p class="p">歌曲 URL 数量：{{ cache ? cache.urlCount : '—' }}</p>
      <p class="p">歌词数量：{{ cache ? cache.lyricCount : '—' }}</p>
      <div class="p gap-top cache-btns">
        <BaseBtn min :disabled="clearing === 'url'" @click="clearCache('url')">
          {{ clearing === 'url' ? '清理中…' : '清理歌曲 URL 缓存' }}
        </BaseBtn>
        <BaseBtn min :disabled="clearing === 'lyric'" @click="clearCache('lyric')">
          {{ clearing === 'lyric' ? '清理中…' : '清理歌词缓存' }}
        </BaseBtn>
      </div>
    </div>
  </dd>

  <AccountLoginDialog
    v-if="loginProvider"
    :provider="loginProvider"
    @close="loginProvider = null"
    @done="onLoginDone"
  />
</template>

<style scoped>
.account-row {
  display: flex;
  align-items: center;
  gap: 12px;
}
.acc-name {
  width: 96px;
  font-size: 13px;
  color: var(--color-font);
}
.acc-status {
  flex: 1;
  font-size: 12px;
  color: var(--color-font-label);
}
.acc-status.ok {
  color: var(--color-primary);
}
.auth-status {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-font-label);
}
.auth-status.ok {
  color: var(--color-primary);
}
.auth-form {
  display: flex;
  gap: 8px;
}
.cache-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.cache-label {
  font-size: 13px;
  color: var(--color-font);
}
.text {
  flex: 1;
  min-width: 0;
  max-width: 320px;
  padding: 6px 10px;
  border-radius: var(--form-radius);
  font-size: 13px;
  color: var(--color-font);
  background-color: var(--color-primary-background);
}
.primary {
  color: #fff;
  background: var(--color-primary);
}
.auth-msg {
  padding: 8px 0 0;
  font-size: 12px;
  color: var(--color-font-label);
}
.auth-msg.ok {
  color: var(--color-primary);
}
.cache-btns {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
</style>
