<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useSettingsStore } from '../stores/settings'
import { useApi } from '../composables/useApi'
import {
  QUALITY_IDS,
  QUALITY_NAMES,
  type AccountProvider,
  type AccountStatus,
  type AppSettings,
  type AuthState,
  type QualityId,
  type SyncStatusSnapshot,
  type UpdaterEvent
} from '@common'
import { THEMES } from '../theme/themes'
import { applyTheme } from '../theme/apply'
import AccountLoginDialog from '../components/AccountLoginDialog.vue'

defineOptions({ name: 'SettingsView' })

const store = useSettingsStore()
const { settings } = storeToRefs(store)
const api = useApi()

function setTheme(id: string): void {
  void store.update({ appearance: { themeId: id } })
  applyTheme(id)
}

function toggleDesktopLyric(enabled: boolean): void {
  void store.update({ lyrics: { desktopEnabled: enabled } })
  void api.desktopLyric.toggle(enabled)
}

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

// —— 平台登录 ——
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

// —— LX 同步 ——
const syncStatus = ref<SyncStatusSnapshot>({ status: 'idle', error: null, serverName: '' })
let syncUnsub: (() => void) | null = null

const SYNC_MODE_LABELS: Record<AppSettings['sync']['syncMode'], string> = {
  merge_local_remote: '合并（本地优先）',
  merge_remote_local: '合并（远端优先）',
  overwrite_local_remote: '用本地覆盖远端',
  overwrite_remote_local: '用远端覆盖本地'
}
const SYNC_STATUS_LABELS: Record<SyncStatusSnapshot['status'], string> = {
  idle: '未连接',
  connecting: '连接中…',
  syncing: '同步中…',
  connected: '已连接',
  failed: '连接失败'
}

async function syncConnect(): Promise<void> {
  await store.update({ sync: { enable: true } })
  await api.sync.connect()
}
async function syncDisconnect(): Promise<void> {
  await api.sync.disconnect()
}

onMounted(() => {
  void api.sync.status().then((s) => (syncStatus.value = s))
  syncUnsub = api.sync.onStatus((s) => (syncStatus.value = s))
})
onUnmounted(() => syncUnsub?.())

// —— 备份 / 导入 ——
const backupMsg = ref('')

async function exportFullBackup(): Promise<void> {
  const name = `kunyin-backup-${new Date().toISOString().slice(0, 10)}.json`
  const path = await api.backup.pickSave(name)
  if (!path) return
  await api.backup.exportFull(path)
  backupMsg.value = `已导出到 ${path}`
}

async function restoreBackup(): Promise<void> {
  const path = await api.backup.pickOpen([{ name: '备份文件', extensions: ['json'] }])
  if (!path) return
  const summary = await api.backup.parse(path).catch(() => null)
  if (!summary) {
    backupMsg.value = '无法解析该备份文件'
    return
  }
  const r = await api.backup.restore(path, { restoreSettings: true, restorePlaylists: true })
  backupMsg.value = `恢复完成：收藏 +${r.favoritesAdded}，歌单 +${r.playlistsCreated}，歌曲 +${r.songsAdded}`
  await store.load()
}

async function importLxFile(): Promise<void> {
  const path = await api.backup.pickOpen([{ name: 'LX 歌单', extensions: ['lxmc', 'json', 'txt'] }])
  if (!path) return
  const summary = await api.backup.lxParse(path).catch(() => null)
  if (!summary) {
    backupMsg.value = '无法识别该 LX 歌单文件'
    return
  }
  const r = await api.backup.lxImport(path)
  if (!r) {
    backupMsg.value = 'LX 导入失败'
    return
  }
  backupMsg.value = `LX 导入完成：收藏 +${r.favoritesAdded}，试听 +${r.trialAdded}，歌单 +${r.playlistsCreated}，歌曲 +${r.songsAdded}`
}

// —— 自动更新 ——
const updateMsg = ref('')
const updateReady = ref(false)
const updateChecking = ref(false)
let updaterUnsub: (() => void) | null = null

async function checkUpdate(): Promise<void> {
  updateChecking.value = true
  updateMsg.value = '正在检查更新…'
  await api.updater.check()
}
async function installUpdate(): Promise<void> {
  await api.updater.install()
}

onMounted(() => {
  updaterUnsub = api.updater.onEvent((e: UpdaterEvent) => {
    switch (e.type) {
      case 'checking':
        updateChecking.value = true
        updateMsg.value = '正在检查更新…'
        break
      case 'available':
        updateChecking.value = false
        updateMsg.value = `发现新版本 ${e.version}，正在下载…`
        void api.updater.download()
        break
      case 'not-available':
        updateChecking.value = false
        updateMsg.value = '已是最新版本'
        break
      case 'progress':
        updateMsg.value = `下载中 ${Math.round(e.percent)}%`
        break
      case 'downloaded':
        updateReady.value = true
        updateMsg.value = `新版本 ${e.version} 已就绪`
        break
      case 'error':
        updateChecking.value = false
        updateMsg.value = `更新出错：${e.message}`
        break
    }
  })
})
onUnmounted(() => updaterUnsub?.())
</script>

<template>
  <div class="page">
    <section class="group">
      <h2 class="group-title">外观</h2>
      <div class="card">
        <div class="row">
          <span class="row-label">主题</span>
          <div class="themes">
            <button
              v-for="t in THEMES"
              :key="t.id"
              class="theme-dot"
              :class="{ on: settings.appearance.themeId === t.id }"
              :title="t.name"
              @click="setTheme(t.id)"
            >
              <span class="dot-inner" :style="{ background: t.primary }" />
            </button>
          </div>
        </div>
      </div>
    </section>

    <section class="group">
      <h2 class="group-title">播放</h2>
      <div class="card">
        <label class="row">
          <span class="row-label">音量</span>
          <input
            class="slider"
            type="range"
            min="0"
            max="1"
            step="0.01"
            :value="settings.player.volume"
            @input="
              store.update({
                player: { volume: Number(($event.target as HTMLInputElement).value) }
              })
            "
          />
        </label>
        <div class="divider" />
        <label class="row">
          <span class="row-label">首选音质</span>
          <select
            class="select"
            :value="settings.player.preferredQuality"
            @change="
              store.update({
                player: {
                  preferredQuality: ($event.target as HTMLSelectElement).value as QualityId
                }
              })
            "
          >
            <option v-for="q in QUALITY_IDS" :key="q" :value="q">{{ QUALITY_NAMES[q] }}</option>
          </select>
        </label>
      </div>
    </section>

    <section class="group">
      <h2 class="group-title">歌词</h2>
      <div class="card">
        <label class="row">
          <span class="row-label">显示翻译</span>
          <input
            class="check"
            type="checkbox"
            :checked="settings.lyrics.showTranslation"
            @change="
              store.update({
                lyrics: { showTranslation: ($event.target as HTMLInputElement).checked }
              })
            "
          />
        </label>
        <div class="divider" />
        <label class="row">
          <span class="row-label">显示音译</span>
          <input
            class="check"
            type="checkbox"
            :checked="settings.lyrics.showRomanization"
            @change="
              store.update({
                lyrics: { showRomanization: ($event.target as HTMLInputElement).checked }
              })
            "
          />
        </label>
        <div class="divider" />
        <label class="row">
          <span class="row-label">桌面歌词</span>
          <input
            class="check"
            type="checkbox"
            :checked="settings.lyrics.desktopEnabled"
            @change="toggleDesktopLyric(($event.target as HTMLInputElement).checked)"
          />
        </label>
        <template v-if="settings.lyrics.desktopEnabled">
          <div class="divider" />
          <label class="row">
            <span class="row-label">桌面歌词字号</span>
            <input
              class="num"
              type="number"
              min="16"
              max="60"
              :value="settings.lyrics.desktopFontSize"
              @change="
                store.update({
                  lyrics: { desktopFontSize: Number(($event.target as HTMLInputElement).value) }
                })
              "
            />
          </label>
          <div class="divider" />
          <label class="row">
            <span class="row-label">已播放颜色</span>
            <input
              class="color"
              type="color"
              :value="settings.lyrics.desktopColorActive"
              @input="
                store.update({
                  lyrics: { desktopColorActive: ($event.target as HTMLInputElement).value }
                })
              "
            />
          </label>
          <div class="divider" />
          <label class="row">
            <span class="row-label">未播放颜色</span>
            <input
              class="color"
              type="color"
              :value="settings.lyrics.desktopColorNormal"
              @input="
                store.update({
                  lyrics: { desktopColorNormal: ($event.target as HTMLInputElement).value }
                })
              "
            />
          </label>
          <div class="divider" />
          <label class="row">
            <span class="row-label">背景不透明度</span>
            <input
              class="slider"
              type="range"
              min="0"
              max="0.8"
              step="0.02"
              :value="settings.lyrics.desktopBgOpacity"
              @input="
                store.update({
                  lyrics: { desktopBgOpacity: Number(($event.target as HTMLInputElement).value) }
                })
              "
            />
          </label>
        </template>
      </div>
    </section>

    <section class="group">
      <h2 class="group-title">下载</h2>
      <div class="card">
        <label class="row">
          <span class="row-label">命名方式</span>
          <select
            class="select"
            :value="settings.download.namingStyle"
            @change="
              store.update({
                download: {
                  namingStyle: ($event.target as HTMLSelectElement)
                    .value as AppSettings['download']['namingStyle']
                }
              })
            "
          >
            <option value="artist-title">歌手 - 歌名</option>
            <option value="title-artist">歌名 - 歌手</option>
            <option value="title-only">仅歌名</option>
          </select>
        </label>
        <div class="divider" />
        <label class="row">
          <span class="row-label">同时下载数</span>
          <input
            class="num"
            type="number"
            min="1"
            max="8"
            :value="settings.download.maxConcurrent"
            @change="
              store.update({
                download: { maxConcurrent: Number(($event.target as HTMLInputElement).value) }
              })
            "
          />
        </label>
        <div class="divider" />
        <label class="row">
          <span class="row-label">无损文件名附加音质标记</span>
          <input
            class="check"
            type="checkbox"
            :checked="settings.download.appendQualityTag"
            @change="
              store.update({
                download: { appendQualityTag: ($event.target as HTMLInputElement).checked }
              })
            "
          />
        </label>
        <div class="divider" />
        <label class="row">
          <span class="row-label">整专单独保存封面</span>
          <input
            class="check"
            type="checkbox"
            :checked="settings.download.saveAlbumCover"
            @change="
              store.update({
                download: { saveAlbumCover: ($event.target as HTMLInputElement).checked }
              })
            "
          />
        </label>
        <div class="divider" />
        <label class="row">
          <span class="row-label">额外保存 .lrc 歌词</span>
          <input
            class="check"
            type="checkbox"
            :checked="settings.download.saveLrcFile"
            @change="
              store.update({
                download: { saveLrcFile: ($event.target as HTMLInputElement).checked }
              })
            "
          />
        </label>
      </div>
    </section>

    <section class="group">
      <h2 class="group-title">平台账号</h2>
      <div class="card">
        <template v-for="(acc, i) in accounts" :key="acc.provider">
          <div v-if="i > 0" class="divider" />
          <div class="row">
            <div class="acc-info">
              <span class="row-label">{{ acc.displayName }}</span>
              <span class="acc-status" :class="acc.loggedIn ? 'ok' : 'off'">
                {{ acc.loggedIn ? acc.nickname || '已登录' : '未登录' }}
              </span>
            </div>
            <button v-if="acc.loggedIn" class="acc-btn" @click="logout(acc.provider)">退出</button>
            <button v-else class="acc-btn primary" @click="loginProvider = acc.provider">
              登录
            </button>
          </div>
        </template>
      </div>
    </section>

    <section class="group">
      <h2 class="group-title">LX 同步</h2>
      <div class="card">
        <label class="row">
          <span class="row-label">启用同步</span>
          <input
            class="check"
            type="checkbox"
            :checked="settings.sync.enable"
            @change="
              store.update({ sync: { enable: ($event.target as HTMLInputElement).checked } })
            "
          />
        </label>
        <template v-if="settings.sync.enable">
          <div class="divider" />
          <label class="row">
            <span class="row-label">服务器地址</span>
            <input
              class="sync-input"
              type="text"
              spellcheck="false"
              :value="settings.sync.serverUrl"
              @change="
                store.update({ sync: { serverUrl: ($event.target as HTMLInputElement).value } })
              "
            />
          </label>
          <div class="divider" />
          <label class="row">
            <span class="row-label">激活卡密 (CDK)</span>
            <input
              class="sync-input"
              type="text"
              spellcheck="false"
              :value="settings.sync.cdk"
              @change="store.update({ sync: { cdk: ($event.target as HTMLInputElement).value } })"
            />
          </label>
          <div class="divider" />
          <label class="row">
            <span class="row-label">设备名</span>
            <input
              class="sync-input"
              type="text"
              spellcheck="false"
              :value="settings.sync.deviceName"
              @change="
                store.update({ sync: { deviceName: ($event.target as HTMLInputElement).value } })
              "
            />
          </label>
          <div class="divider" />
          <label class="row">
            <span class="row-label">同步模式</span>
            <select
              class="select"
              :value="settings.sync.syncMode"
              @change="
                store.update({
                  sync: {
                    syncMode: ($event.target as HTMLSelectElement)
                      .value as AppSettings['sync']['syncMode']
                  }
                })
              "
            >
              <option v-for="(label, val) in SYNC_MODE_LABELS" :key="val" :value="val">
                {{ label }}
              </option>
            </select>
          </label>
          <div class="divider" />
          <label class="row">
            <span class="row-label">开机自动连接</span>
            <input
              class="check"
              type="checkbox"
              :checked="settings.sync.autoConnect"
              @change="
                store.update({ sync: { autoConnect: ($event.target as HTMLInputElement).checked } })
              "
            />
          </label>
          <div class="divider" />
          <div class="row">
            <div class="acc-info">
              <span class="row-label">连接状态</span>
              <span class="acc-status" :class="syncStatus.status === 'connected' ? 'ok' : 'off'">
                {{ SYNC_STATUS_LABELS[syncStatus.status]
                }}{{ syncStatus.serverName ? ` · ${syncStatus.serverName}` : '' }}
                <template v-if="syncStatus.status === 'failed' && syncStatus.error">
                  （{{ syncStatus.error }}）
                </template>
              </span>
            </div>
            <button
              v-if="syncStatus.status === 'idle' || syncStatus.status === 'failed'"
              class="acc-btn primary"
              @click="syncConnect"
            >
              连接
            </button>
            <button v-else class="acc-btn" @click="syncDisconnect">断开</button>
          </div>
        </template>
      </div>
    </section>

    <section class="group">
      <h2 class="group-title">卡密</h2>
      <div class="card">
        <div class="row auth-row">
          <span class="row-label">卡密</span>
          <span class="auth-status" :class="authState.isValid ? 'ok' : 'off'">
            {{ authState.isValid ? '已激活' : '未激活' }}
          </span>
        </div>
        <div class="divider" />
        <div class="auth-form">
          <input
            v-model="authInput"
            class="auth-input"
            type="text"
            placeholder="输入卡密以解锁 QQ / 酷狗及无损音质"
            spellcheck="false"
            @keyup.enter="validateAuth"
          />
          <button class="auth-btn primary" :disabled="authBusy" @click="validateAuth">
            {{ authBusy ? '校验中…' : '激活' }}
          </button>
          <button v-if="authState.authst" class="auth-btn" @click="clearAuth">清除</button>
        </div>
        <p v-if="authState.message" class="auth-msg" :class="{ ok: authState.isValid }">
          {{ authState.message }}
        </p>
      </div>
    </section>

    <section class="group">
      <h2 class="group-title">备份与导入</h2>
      <div class="card">
        <div class="row">
          <span class="row-label">完整备份</span>
          <button class="acc-btn" @click="exportFullBackup">导出</button>
        </div>
        <div class="divider" />
        <div class="row">
          <span class="row-label">恢复备份</span>
          <button class="acc-btn" @click="restoreBackup">选择文件</button>
        </div>
        <div class="divider" />
        <div class="row">
          <span class="row-label">导入 LX 歌单</span>
          <button class="acc-btn" @click="importLxFile">选择 .lxmc</button>
        </div>
        <p v-if="backupMsg" class="auth-msg">{{ backupMsg }}</p>
      </div>
    </section>

    <section class="group">
      <h2 class="group-title">软件更新</h2>
      <div class="card">
        <div class="row">
          <div class="acc-info">
            <span class="row-label">检查更新</span>
            <span v-if="updateMsg" class="acc-status off">{{ updateMsg }}</span>
          </div>
          <button v-if="updateReady" class="acc-btn primary" @click="installUpdate">
            重启安装
          </button>
          <button v-else class="acc-btn" :disabled="updateChecking" @click="checkUpdate">
            {{ updateChecking ? '检查中…' : '检查更新' }}
          </button>
        </div>
      </div>
    </section>

    <AccountLoginDialog
      v-if="loginProvider"
      :provider="loginProvider"
      @close="loginProvider = null"
      @done="onLoginDone"
    />
  </div>
</template>

<style scoped>
.group {
  max-width: 620px;
  margin-bottom: 24px;
}
.group-title {
  margin-bottom: 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--color-font-label);
}
.card {
  border: 1px solid var(--color-primary-alpha-900);
  border-radius: var(--radius-border);
  background-color: var(--color-content-background);
  overflow: hidden;
}
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 15px;
  min-height: 46px;
}
.row-label {
  font-size: 13px;
  color: var(--color-font);
}
.divider {
  height: 1px;
  margin-left: 15px;
  background-color: var(--color-primary-alpha-900);
}
.slider {
  width: 200px;
  accent-color: var(--color-primary);
}
.check {
  width: 16px;
  height: 16px;
  accent-color: var(--color-primary);
}
.select {
  padding: 6px 10px;
  border-radius: var(--form-radius);
  background-color: var(--color-primary-background);
  color: var(--color-font);
  cursor: pointer;
}
.num {
  width: 64px;
  padding: 6px 10px;
  border-radius: var(--form-radius);
  background-color: var(--color-primary-background);
  color: var(--color-font);
  text-align: center;
}
.color {
  width: 40px;
  height: 26px;
  padding: 0;
  border: none;
  border-radius: var(--form-radius);
  background: none;
  cursor: pointer;
}

.themes {
  display: flex;
  gap: 10px;
}
.theme-dot {
  width: 26px;
  height: 26px;
  padding: 3px;
  border-radius: 50%;
  box-shadow: 0 0 0 2px transparent;
  transition: box-shadow 0.2s ease;
}
.theme-dot.on {
  box-shadow: 0 0 0 2px var(--color-primary);
}
.dot-inner {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: 50%;
}

/* 平台账号 */
.acc-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.acc-status {
  font-size: 12px;
}
.acc-status.ok {
  color: var(--color-primary);
}
.acc-status.off {
  color: var(--color-font-label);
}
.acc-btn {
  flex: none;
  padding: 6px 16px;
  border-radius: var(--form-radius);
  font-size: 13px;
  color: var(--color-font);
  background-color: var(--color-primary-background);
}
.acc-btn.primary {
  color: #fff;
  background-color: var(--color-primary);
}
.acc-btn:hover {
  filter: brightness(1.03);
}
.sync-input {
  width: 260px;
  padding: 6px 10px;
  border-radius: var(--form-radius);
  font-size: 13px;
  color: var(--color-font);
  background-color: var(--color-primary-background);
}

/* 卡密激活 */
.auth-status {
  font-size: 12px;
  font-weight: 600;
}
.auth-status.ok {
  color: var(--color-primary);
}
.auth-status.off {
  color: var(--color-font-label);
}
.auth-form {
  display: flex;
  gap: 8px;
  padding: 12px 15px;
}
.auth-input {
  flex: 1;
  min-width: 0;
  padding: 7px 10px;
  border-radius: var(--form-radius);
  font-size: 13px;
  color: var(--color-font);
  background-color: var(--color-primary-background);
}
.auth-btn {
  flex: none;
  padding: 7px 16px;
  border-radius: var(--form-radius);
  font-size: 13px;
  color: var(--color-font);
  background-color: var(--color-primary-background);
  transition: background-color 0.15s ease;
}
.auth-btn:hover {
  background-color: var(--color-primary-background-hover);
}
.auth-btn.primary {
  color: #fff;
  background-color: var(--color-primary);
}
.auth-btn.primary:hover {
  filter: brightness(1.05);
}
.auth-btn:disabled {
  opacity: 0.6;
  cursor: default;
}
.auth-msg {
  padding: 0 15px 12px;
  font-size: 12px;
  color: var(--color-font-label);
}
.auth-msg.ok {
  color: var(--color-primary);
}
</style>
