<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useApi } from '../../composables/useApi'
import { useSettingsStore } from '../../stores/settings'
import type { AccountProvider, AccountStatus, CacheKind, CacheStats } from '@common'
import AccountLoginDialog from '../../components/AccountLoginDialog.vue'
import BaseBtn from '../../components/BaseBtn.vue'
import BaseInput from '../../components/BaseInput.vue'
import BaseSelect from '../../components/BaseSelect.vue'

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
  <dt id="other">其他</dt>
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
    <h3 id="other_cache">缓存管理</h3>
    <div class="cache-list">
      <div class="cache-item">
        <div class="cache-info">
          <span class="cache-name">资源缓存</span>
          <span class="cache-desc">封面等图片，由浏览器内核缓存，清理后重新联网获取</span>
        </div>
        <span class="cache-value">{{ cache ? fmtSize(cache.resourceBytes) : '统计中…' }}</span>
        <div class="cache-actions">
          <BaseBtn min :disabled="clearing === 'resource'" @click="clearCache('resource')">
            {{ clearing === 'resource' ? '清理中…' : '清理' }}
          </BaseBtn>
        </div>
      </div>

      <div id="other_cache_audio" class="cache-item">
        <div class="cache-info">
          <span class="cache-name">音频缓存</span>
          <span class="cache-desc">完整听过的歌存到本地，重听时不再联网下载</span>
        </div>
        <div class="cache-extra">
          <label class="cache-limit" for="setting_audio_cache_limit">容量上限</label>
          <BaseSelect
            id="setting_audio_cache_limit"
            class="limit-select"
            :model-value="audioLimit"
            :list="audioLimitList"
            @update:model-value="setAudioLimit"
          />
        </div>
        <span class="cache-value">
          {{ cache ? `${fmtSize(cache.audioBytes)} · ${cache.audioCount} 首` : '统计中…' }}
        </span>
        <div class="cache-actions">
          <BaseBtn min :disabled="clearing === 'audio'" @click="clearCache('audio')">
            {{ clearing === 'audio' ? '清理中…' : '清理' }}
          </BaseBtn>
        </div>
      </div>

      <div id="other_cache_other" class="cache-item">
        <div class="cache-info">
          <span class="cache-name">歌曲 URL 缓存</span>
          <span class="cache-desc">解析过的播放地址，按直链时效自动失效</span>
        </div>
        <span class="cache-value">{{ cache ? `${cache.urlCount} 条` : '—' }}</span>
        <div class="cache-actions">
          <BaseBtn min :disabled="clearing === 'url'" @click="clearCache('url')">
            {{ clearing === 'url' ? '清理中…' : '清理' }}
          </BaseBtn>
        </div>
      </div>

      <div class="cache-item">
        <div class="cache-info">
          <span class="cache-name">歌词缓存</span>
          <span class="cache-desc">取过的歌词，再次播放直接读本地</span>
        </div>
        <span class="cache-value">{{ cache ? `${cache.lyricCount} 首` : '—' }}</span>
        <div class="cache-actions">
          <BaseBtn min :disabled="clearing === 'lyric'" @click="clearCache('lyric')">
            {{ clearing === 'lyric' ? '清理中…' : '清理' }}
          </BaseBtn>
        </div>
      </div>
    </div>
  </dd>

  <dd>
    <h3 id="other_dislike">「不喜欢的歌曲」规则</h3>
    <div>
      <BaseInput
        multiline
        :model-value="settings.player.dislikeRules"
        placeholder="每行一个歌名；屏蔽歌手请填写 @歌手名"
        @change="
          settingsStore.update({
            player: { dislikeRules: ($event.target as HTMLTextAreaElement).value }
          })
        "
      />
      <p class="p dislike-tip">播放队列会跳过匹配项。删除对应行即可取消屏蔽。</p>
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
.dislike-tip {
  margin-top: 8px;
  color: var(--color-font-label);
  font-size: 12px;
}
:deep(textarea) {
  display: block;
  width: min(460px, 100%);
  min-height: 100px;
}
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
.primary {
  color: #fff;
  background: var(--color-primary);
}
/*
 * 缓存管理：一类一行，名称/说明 | 额外控件 | 用量 | 清理 四列（subgrid 让各行列宽一致）。
 * 用量紧挨着自己的「清理」按钮；额外控件列只有音频行用（容量上限）。
 */
.cache-list {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto auto;
  column-gap: 16px;
}
.cache-item {
  display: grid;
  grid-column: 1 / -1;
  grid-template-columns: subgrid;
  align-items: center;
  min-height: 52px;
  padding: 8px 0;
}
.cache-item + .cache-item {
  border-top: 1px solid var(--color-primary-alpha-900);
}
.cache-info {
  grid-column: 1;
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}
.cache-name {
  font-size: 13px;
  color: var(--color-font);
}
.cache-desc {
  font-size: 11px;
  color: var(--color-font-label);
}
.cache-value {
  grid-column: 3;
  justify-self: end;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  color: var(--color-font);
  white-space: nowrap;
}
.cache-extra {
  grid-column: 2;
  display: flex;
  align-items: center;
  gap: 8px;
}
.cache-actions {
  grid-column: 4;
  display: flex;
  justify-content: flex-end;
}
.cache-limit {
  font-size: 12px;
  color: var(--color-font-label);
}
.limit-select {
  min-width: 0;
  height: 30px;
  padding: 0 30px 0 10px;
}
</style>
