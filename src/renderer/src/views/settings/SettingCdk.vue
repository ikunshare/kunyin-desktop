<script setup lang="ts">
/**
 * 卡密管理：填写 / 清除卡密（原在「其他」），并经 POST /cdk/query 自查当前卡密的类型、状态、
 * 有效期与额度。查询只读、不计使用次数、不消耗额度，打开页面时自动查一次。
 * 各字段口径见 @common 的 CdkInfo / CdkQuota。
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useApi } from '../../composables/useApi'
import type {
  AuthState,
  CdkInfo,
  CdkQueryResult,
  KunyinAccount,
  KunyinKey,
  KunyinQRCode,
  LocalQQAccount
} from '@common'
import AppIcon from '../../components/AppIcon.vue'
import BaseBtn from '../../components/BaseBtn.vue'

const api = useApi()

// —— 网页版账号（QQ 快捷登录 / 扫码登录 + 名下卡密） ——
const account = ref<KunyinAccount>({ loggedIn: false, keys: [] })
const accountBusy = ref<'' | 'quick' | 'login' | 'refresh' | 'logout'>('')
const accountMsg = ref('')
const localList = ref<LocalQQAccount[]>([])
const qrCode = ref<KunyinQRCode | null>(null)
const qrText = ref('')
let qrSig = ''
let qrTimer: ReturnType<typeof setTimeout> | undefined

/** 卡密管理操作的反馈与忙碌标记（选用 / 绑定 / 换卡 / 进群码共用） */
const keyBusy = ref('')
const keyMsg = ref('')
const groupCode = ref('')
const bindKeyInput = ref('')
const migrateKeyInput = ref('')

onMounted(async () => {
  // 先用落盘快照渲染，再静默刷新一次 /user/me
  account.value = await api.kunyin.account()
  api.kunyin
    .refresh()
    .then((a) => {
      account.value = a
    })
    .catch(() => {
      /* 后端不可达时保留快照 */
    })
})

// —— 账号登录 ——

function applyAccount(a: KunyinAccount): void {
  account.value = a
  localList.value = []
  stopQR()
}

async function quickLogin(): Promise<void> {
  if (accountBusy.value) return
  accountBusy.value = 'quick'
  accountMsg.value = ''
  try {
    const list = await api.kunyin.localAccounts()
    if (list.length === 0) {
      accountMsg.value = '未检测到本机 QQ，请使用扫码登录'
      return
    }
    if (list.length === 1) {
      await loginWith(list[0].uin)
      return
    }
    localList.value = list
  } finally {
    accountBusy.value = ''
  }
}

async function loginWith(uin: string): Promise<void> {
  accountBusy.value = 'login'
  accountMsg.value = ''
  try {
    const r = await api.kunyin.quickLogin(uin)
    if (r.ok) {
      applyAccount(r.account)
      accountMsg.value = `已登录：${r.account.nickname || r.account.musicid}`
    } else {
      accountMsg.value = r.message
      if (r.reason === 'no_qq') localList.value = []
    }
  } finally {
    accountBusy.value = ''
  }
}

function pickLocal(uin: string): void {
  if (accountBusy.value) return
  void loginWith(uin)
}

async function startQR(): Promise<void> {
  if (accountBusy.value) return
  accountMsg.value = ''
  qrText.value = '正在获取二维码…'
  try {
    qrCode.value = await api.kunyin.qrNew()
    qrSig = qrCode.value.qrsig
    qrText.value = '请使用手机 QQ 扫码'
    scheduleQR(2000)
  } catch (e) {
    qrText.value = e instanceof Error ? e.message : '获取二维码失败'
    qrCode.value = null
  }
}

function scheduleQR(ms: number): void {
  clearTimeout(qrTimer)
  qrTimer = setTimeout(() => void pollQR(), ms)
}

async function pollQR(): Promise<void> {
  if (!qrSig) return
  try {
    const r = await api.kunyin.qrPoll(qrSig)
    if (r.status === 'wait_scan' || r.status === 'scanned') {
      qrText.value = r.status === 'scanned' ? '已扫描，请在手机上确认' : '请使用手机 QQ 扫码'
      scheduleQR(2000)
      return
    }
    if (r.status === 'done') {
      qrSig = ''
      if (r.account) {
        applyAccount(r.account)
        accountMsg.value = '扫码登录成功'
      } else {
        accountMsg.value = r.message ?? '登录状态校验失败'
        qrCode.value = null
      }
      return
    }
    qrSig = ''
    qrText.value = r.message || (r.status === 'expired' ? '二维码已失效' : '登录失败')
    qrCode.value = null
  } catch {
    scheduleQR(3000)
  }
}

function stopQR(): void {
  clearTimeout(qrTimer)
  qrSig = ''
  qrCode.value = null
  qrText.value = ''
}

onUnmounted(() => clearTimeout(qrTimer))

async function refreshAccount(): Promise<void> {
  if (accountBusy.value) return
  accountBusy.value = 'refresh'
  try {
    account.value = await api.kunyin.refresh()
    accountMsg.value = account.value.loggedIn ? '' : '登录已失效，请重新登录'
  } catch (e) {
    accountMsg.value = e instanceof Error ? e.message : '刷新失败'
  } finally {
    accountBusy.value = ''
  }
}

async function logoutAccount(): Promise<void> {
  if (accountBusy.value) return
  accountBusy.value = 'logout'
  try {
    account.value = await api.kunyin.logout()
    accountMsg.value = ''
    keyMsg.value = ''
  } finally {
    accountBusy.value = ''
  }
}

// —— 名下卡密 ——

const maskKey = (k: string): string => (k.length > 12 ? `${k.slice(0, 8)}…${k.slice(-4)}` : k)

const keyExpired = (k: KunyinKey): boolean => !!k.expiresAt && Date.parse(k.expiresAt) < Date.now()
const keyUsable = (k: KunyinKey): boolean => !keyExpired(k)

function keyStateLabel(k: KunyinKey): string {
  if (keyExpired(k)) return '已过期'
  if (!k.isActive) return '已下架'
  return '有效'
}

function keyTone(k: KunyinKey): Tone {
  if (keyExpired(k)) return 'bad'
  if (!k.isActive) return 'idle'
  return 'ok'
}

function keyExpiry(k: KunyinKey): string {
  if (!k.expiresAt) return k.type === 'permanent' ? '永久有效' : '首次使用后开始计时'
  return `${fmtTime(k.expiresAt)} 到期`
}

function keyQuota(k: KunyinKey): string {
  const q = k.quota
  if (!q || q.limit <= 0) return q ? `已用 ${q.used} 次` : '不限'
  return `${q.used} / ${q.limit} 次${q.exceeded ? '（已用完）' : ''}`
}

async function useKey(key: string): Promise<void> {
  if (keyBusy.value) return
  keyBusy.value = key
  keyMsg.value = ''
  try {
    authState.value = await api.kunyin.useKey(key)
    authInput.value = authState.value.authst
    if (authState.value.isValid) {
      keyMsg.value = `已选用卡密 ${maskKey(key)}`
      result.value = null
      void refreshInfo()
    } else {
      keyMsg.value = authState.value.message || '卡密不可用'
    }
  } finally {
    keyBusy.value = ''
  }
}

async function doBind(): Promise<void> {
  const key = bindKeyInput.value.trim()
  if (!key) {
    keyMsg.value = '请先粘贴要绑定的卡密'
    return
  }
  if (keyBusy.value) return
  keyBusy.value = 'bind'
  try {
    const r = await api.kunyin.bindKey(key)
    keyMsg.value = r.message
    if (r.ok) {
      bindKeyInput.value = ''
      account.value = await api.kunyin.refresh()
    }
  } finally {
    keyBusy.value = ''
  }
}

async function doMigrate(): Promise<void> {
  const oldKey = migrateKeyInput.value.trim()
  if (!oldKey) {
    keyMsg.value = '请先粘贴旧卡密'
    return
  }
  if (keyBusy.value) return
  keyBusy.value = 'migrate'
  try {
    const r = await api.kunyin.migrateKey(oldKey)
    keyMsg.value = r.ok && r.newKey ? `换卡成功，新卡密：${r.newKey}` : r.message
    if (r.ok) {
      migrateKeyInput.value = ''
      account.value = await api.kunyin.refresh()
    }
  } finally {
    keyBusy.value = ''
  }
}

async function doGroupCode(key: string): Promise<void> {
  if (keyBusy.value) return
  keyBusy.value = key
  groupCode.value = ''
  try {
    const r = await api.kunyin.groupCode(key)
    if (r.ok && r.code) groupCode.value = r.code
    else keyMsg.value = r.message
  } finally {
    keyBusy.value = ''
  }
}

// —— 卡密激活 ——
const authInput = ref('')
const authState = ref<AuthState>({ authst: '', isValid: false, message: '' })
const authBusy = ref(false)

// —— 卡密信息 ——
const result = ref<CdkQueryResult | null>(null)
const querying = ref(false)
/** 查询序号：只采纳最近一次查询的结果，换卡或清除后迟到的旧结果直接丢掉 */
let querySeq = 0

onMounted(async () => {
  authState.value = await api.auth.get()
  authInput.value = authState.value.authst
  void refreshInfo()
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
  // 校验没过时主进程沿用原来的卡密，下面的信息不用重查
  if (authState.value.isValid) {
    result.value = null
    void refreshInfo()
  }
}
async function clearAuth(): Promise<void> {
  authState.value = await api.auth.clear()
  authInput.value = ''
  querySeq++
  result.value = null
  querying.value = false
}

async function refreshInfo(): Promise<void> {
  if (!authState.value.authst) return
  const seq = ++querySeq
  querying.value = true
  const r = await api.auth
    .query()
    .catch((): CdkQueryResult => ({ ok: false, message: '查询失败，请稍后重试' }))
  if (seq !== querySeq) return
  result.value = r
  querying.value = false
}

const TYPE_LABELS: Record<string, string> = {
  week: '周卡',
  month: '月卡',
  year: '年卡',
  permanent: '永久卡'
}
/** 各类型的有效天数（后端首次使用时按它写到期时间），只用来画剩余有效期的进度条 */
const TYPE_DAYS: Record<string, number> = { week: 7, month: 30, year: 365 }
const STATE_LABELS: Record<string, string> = {
  valid: '有效',
  inactive: '未激活',
  expired: '已过期',
  banned: '已停用'
}
const DAY_MS = 86_400_000

type Tone = 'ok' | 'idle' | 'bad'

const info = computed<CdkInfo | null>(() => (result.value?.ok ? result.value.info : null))

const maskedKey = computed(() => {
  const k = authState.value.authst
  return k.length > 12 ? `${k.slice(0, 8)}…${k.slice(-4)}` : k
})

const typeLabel = computed(() => {
  const t = info.value?.type ?? ''
  return TYPE_LABELS[t] ?? (t || '卡密')
})
const stateTone = computed<Tone>(() => {
  const s = info.value?.state
  return s === 'valid' ? 'ok' : s === 'expired' || s === 'banned' ? 'bad' : 'idle'
})
/**
 * 卡密图标的色调：没卡密 / 查询中按 idle，查询失败按 bad，其余跟卡密状态走。
 * 后端 message 只在它比状态标签多说了点什么时才单独显示：未激活（何时开始计时）、额度用完
 * （何时重置）、查询失败（原因）。「卡密有效」「卡密已过期」与标签重复，不再显示一遍。
 */
const headTone = computed<Tone>(() => {
  const r = result.value
  if (!r) return 'idle'
  return r.ok ? stateTone.value : 'bad'
})
const notice = computed<{ text: string; tone: Tone } | null>(() => {
  const r = result.value
  if (!r) return null
  if (!r.ok) return { text: r.message, tone: 'bad' }
  if (!r.message) return null
  if (r.info.quota.exceeded) return { text: r.message, tone: 'bad' }
  if (r.info.state === 'inactive') return { text: r.message, tone: 'idle' }
  return null
})

const headTitle = computed(() => {
  if (!authState.value.authst) return '未填写卡密'
  if (!result.value) return '正在查询…'
  return result.value.ok ? typeLabel.value : '查询失败'
})

/** 带时区偏移的 RFC3339 → 本地时间「YYYY-MM-DD HH:mm」；解析不了原样返回 */
function fmtTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

const activation = computed(() => {
  const at = info.value?.activatedAt
  return at ? `${fmtTime(at)} 激活` : '尚未使用'
})

interface Stat {
  label: string
  value: string
  unit: string
  sub: string
  /** 进度条百分比；null 表示这一项没有进度可画（占位但不显示） */
  percent: number | null
  tone: Tone
}
/** 剩余有效期：剩余天数 + 剩余占整个有效期的比例 + 到期时间 */
function validityStat(i: CdkInfo): Stat {
  const base = { label: '剩余有效期', unit: '', tone: stateTone.value }
  if (!i.expiresAt) {
    if (i.type === 'permanent') return { ...base, value: '永久', sub: '不会过期', percent: 100 }
    const days = TYPE_DAYS[i.type]
    return days
      ? { ...base, value: String(days), unit: '天', sub: '首次使用后开始计时', percent: 100 }
      : { ...base, value: '—', sub: '首次使用后开始计时', percent: null }
  }
  const sub = `${fmtTime(i.expiresAt)} 到期`
  const left = Date.parse(i.expiresAt) - Date.now()
  if (i.state === 'expired' || !(left > 0)) {
    return { ...base, value: '已过期', sub, percent: 0, tone: 'bad' }
  }
  const days = Math.floor(left / DAY_MS)
  const total = (TYPE_DAYS[i.type] ?? 0) * DAY_MS
  return {
    ...base,
    value: days >= 1 ? String(days) : '不足 1',
    unit: '天',
    sub,
    percent: total ? Math.min(100, (left / total) * 100) : null
  }
}

/** 使用额度：本周期已用 / 上限 + 重置规则；上限为 0 表示不限 */
function quotaStat(i: CdkInfo): Stat {
  const q = i.quota
  const n = (v: number): string => v.toLocaleString('zh-CN')
  const base = { label: '使用额度', tone: (q.exceeded ? 'bad' : 'ok') as Tone }
  if (q.limit <= 0) {
    return { ...base, value: '不限', unit: '', sub: `已用 ${n(q.used)} 次`, percent: null }
  }
  const sub =
    q.periodDays > 0
      ? `每 ${q.periodDays} 天重置` + (q.resetAt ? `，下次 ${fmtTime(q.resetAt)}` : '')
      : '有效期内累计，不自动重置'
  return {
    ...base,
    value: n(q.used),
    unit: `/ ${n(q.limit)} 次`,
    sub,
    percent: Math.min(100, (q.used / q.limit) * 100)
  }
}

const stats = computed<Stat[]>(() =>
  info.value ? [validityStat(info.value), quotaStat(info.value)] : []
)

/** 进度很小时也露出一截，否则 3 / 20000 看起来跟没用一样 */
function barWidth(percent: number | null): string {
  return percent ? `max(6px, ${percent}%)` : '0'
}
</script>

<template>
  <dt id="cdk">卡密管理</dt>

  <!-- —— 网页版账号：QQ 登录 + 名下卡密 —— -->
  <dd>
    <h3 id="cdk_account">QQ 账号</h3>

    <!-- 未登录 -->
    <div v-if="!account.loggedIn">
      <div class="acct-actions">
        <BaseBtn min class="primary" :disabled="accountBusy !== ''" @click="quickLogin">
          {{ accountBusy === 'quick' || accountBusy === 'login' ? '登录中…' : 'QQ 快捷登录' }}
        </BaseBtn>
        <BaseBtn min :disabled="accountBusy !== ''" @click="startQR">扫码登录</BaseBtn>
      </div>
      <p class="auth-msg">登录后可查看名下卡密、选用、换卡与获取进群验证码。</p>

      <!-- 本机检测到多个 QQ 时选择账号 -->
      <div v-if="localList.length" class="local-list">
        <span class="local-title">选择本机已登录的 QQ</span>
        <button
          v-for="a in localList"
          :key="a.uin"
          class="local-item"
          :disabled="accountBusy !== ''"
          @click="pickLocal(a.uin)"
        >
          <img :src="a.avatar" alt="" referrerpolicy="no-referrer" />
          <span>{{ a.nickname || a.uin }}</span>
        </button>
      </div>

      <!-- 扫码 -->
      <div v-if="qrCode" class="qr-box">
        <img :src="qrCode.image" alt="登录二维码" />
        <p class="auth-msg">{{ qrText }}</p>
        <BaseBtn min @click="stopQR">取消</BaseBtn>
      </div>
      <p v-else-if="qrText" class="auth-msg">{{ qrText }}</p>

      <p v-if="accountMsg" class="auth-msg">{{ accountMsg }}</p>
    </div>

    <!-- 已登录 -->
    <div v-else>
      <div class="acct-me">
        <img class="acct-avatar" :src="account.avatar" alt="" referrerpolicy="no-referrer" />
        <div class="acct-main">
          <div class="acct-name">
            {{ account.nickname || 'QQ 用户' }}
            <span class="acct-qq">QQ {{ account.musicid }}</span>
          </div>
          <p class="auth-msg">名下 {{ account.keys.length }} 张卡密</p>
        </div>
        <BaseBtn min :disabled="accountBusy !== ''" @click="refreshAccount">
          {{ accountBusy === 'refresh' ? '刷新中…' : '刷新' }}
        </BaseBtn>
        <BaseBtn min :disabled="accountBusy !== ''" @click="logoutAccount">
          {{ accountBusy === 'logout' ? '退出中…' : '退出' }}
        </BaseBtn>
      </div>

      <div v-if="!account.keys.length" class="acct-empty">
        这个 QQ 名下还没有卡密，可以在下方「绑定卡密」归入本账号。
      </div>
      <div v-else class="key-list">
        <div v-for="k in account.keys" :key="k.key" class="key-row">
          <div class="key-main">
            <div class="key-top">
              <span class="key-text">{{ maskKey(k.key) }}</span>
              <span class="chip" :class="keyTone(k)">{{ keyStateLabel(k) }}</span>
              <span class="chip">{{ TYPE_LABELS[k.type] ?? k.type }}</span>
            </div>
            <p class="key-sub">
              {{ keyExpiry(k) }} · 使用 {{ k.usageCount }} 次 · 额度 {{ keyQuota(k) }}
            </p>
          </div>
          <BaseBtn
            min
            class="primary"
            :disabled="!keyUsable(k) || keyBusy !== ''"
            @click="useKey(k.key)"
          >
            {{ keyBusy === k.key ? '选用中…' : '选用' }}
          </BaseBtn>
          <BaseBtn min :disabled="keyBusy !== ''" @click="doGroupCode(k.key)">进群码</BaseBtn>
        </div>
      </div>

      <div class="inline-form">
        <input
          v-model="bindKeyInput"
          class="text"
          type="text"
          placeholder="粘贴要绑定到当前 QQ 的卡密"
          spellcheck="false"
          @keyup.enter="doBind"
        />
        <BaseBtn min :disabled="keyBusy !== ''" @click="doBind">绑定</BaseBtn>
      </div>
      <div class="inline-form">
        <input
          v-model="migrateKeyInput"
          class="text"
          type="text"
          placeholder="旧卡密换新卡（旧卡立即作废）"
          spellcheck="false"
          @keyup.enter="doMigrate"
        />
        <BaseBtn min :disabled="keyBusy !== ''" @click="doMigrate">换卡</BaseBtn>
      </div>

      <p v-if="keyMsg" class="auth-msg">{{ keyMsg }}</p>
      <p v-if="groupCode" class="group-code">
        进群验证码：<b>{{ groupCode }}</b
        >（10 分钟内有效）
      </p>
    </div>
  </dd>

  <dd>
    <h3 id="cdk_auth">卡密</h3>
    <div>
      <div class="auth-form">
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
    <h3 id="cdk_info">卡密信息</h3>
    <div class="head">
      <span class="head-icon" :class="headTone"><AppIcon name="key" :size="20" /></span>
      <div class="head-main">
        <div class="head-title">
          <span>{{ headTitle }}</span>
          <span v-if="info" class="chip" :class="stateTone">
            {{ STATE_LABELS[info.state] ?? info.state }}
          </span>
        </div>
        <p class="head-meta">
          <template v-if="!authState.authst">激活卡密后，这里会显示类型、有效期和使用额度</template>
          <template v-else>
            <span class="key">{{ maskedKey }}</span>
            <template v-if="info"> · {{ activation }}</template>
          </template>
        </p>
      </div>
      <BaseBtn
        v-if="authState.authst"
        min
        class="refresh"
        :disabled="querying"
        @click="refreshInfo"
      >
        <AppIcon name="refresh" :size="14" :class="{ spinning: querying }" />
        <span>{{ querying ? '查询中' : '刷新' }}</span>
      </BaseBtn>
    </div>
    <p v-if="notice" class="notice" :class="notice.tone">{{ notice.text }}</p>
    <div v-if="stats.length" class="stats">
      <div v-for="s in stats" :key="s.label" class="stat">
        <span class="stat-label">{{ s.label }}</span>
        <span class="stat-value" :class="s.tone">
          {{ s.value }}<small v-if="s.unit">{{ s.unit }}</small>
        </span>
        <div class="bar" :class="[s.tone, { placeholder: s.percent === null }]">
          <span :style="{ width: barWidth(s.percent) }" />
        </div>
        <span class="stat-sub">{{ s.sub }}</span>
      </div>
    </div>
    <p v-if="stats.length" class="footnote">
      额度只统计 QQ 音乐、酷狗、Apple Music 取链成功的次数，命中缓存不计；刷新查询不消耗额度。
    </p>
  </dd>
</template>

<style scoped>
.auth-form {
  display: flex;
  gap: 8px;
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

/* —— QQ 账号 —— */
.acct-actions {
  display: flex;
  gap: 8px;
}
.local-list {
  display: grid;
  gap: 8px;
  margin-top: 12px;
}
.local-title {
  font-size: 12px;
  color: var(--color-font-label);
}
.local-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border: 1px solid var(--color-primary-alpha-900);
  border-radius: 10px;
  color: var(--color-font);
  font-size: 13px;
  text-align: left;
  background: var(--color-primary-background);
  cursor: pointer;
}
.local-item:disabled {
  opacity: 0.5;
  cursor: default;
}
.local-item img {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  object-fit: cover;
}
.qr-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  margin-top: 14px;
}
.qr-box img {
  width: 168px;
  height: 168px;
  padding: 8px;
  border-radius: 12px;
  background: #fff;
}
.acct-me {
  display: flex;
  align-items: center;
  gap: 12px;
}
.acct-avatar {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  object-fit: cover;
  background: var(--color-primary-background);
}
.acct-main {
  flex: 1;
  min-width: 0;
}
.acct-name {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  font-weight: 650;
  color: var(--color-font);
}
.acct-qq {
  font-size: 12px;
  font-weight: 400;
  color: var(--color-font-label);
}
.acct-empty {
  margin-top: 14px;
  padding: 10px 12px;
  border-radius: 8px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--color-font-label);
  background: var(--color-primary-background);
}
.key-list {
  display: grid;
  gap: 8px;
  margin-top: 14px;
}
.key-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--color-primary-alpha-900);
  border-radius: 10px;
}
.key-main {
  flex: 1;
  min-width: 0;
}
.key-top {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.key-text {
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
  font-size: 13px;
  color: var(--color-font);
}
.key-sub {
  margin-top: 4px;
  font-size: 11.5px;
  color: var(--color-font-label);
  overflow-wrap: anywhere;
}
.inline-form {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}
.group-code {
  margin-top: 12px;
  padding: 10px 12px;
  border-radius: 8px;
  font-size: 13px;
  color: var(--color-font);
  background: var(--color-primary-background);
}
.group-code b {
  margin-left: 4px;
  font-size: 18px;
  letter-spacing: 0.12em;
  color: var(--color-primary);
}

/* —— 卡密信息：图标 + 类型 / 状态 + 刷新 —— */
.head {
  display: flex;
  align-items: center;
  gap: 14px;
}
.head-icon {
  flex: none;
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border-radius: 12px;
  color: var(--color-primary);
  background: var(--color-primary-background);
}
.head-main {
  flex: 1;
  min-width: 0;
}
.head-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 16px;
  font-weight: 650;
  line-height: 1.3;
  color: var(--color-font);
}
.head-meta {
  margin-top: 3px;
  font-size: 12px;
  color: var(--color-font-label);
  overflow-wrap: anywhere;
}
.key {
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
}
.chip {
  padding: 0 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  line-height: 20px;
  color: var(--color-primary);
  background: var(--color-primary-background);
}
.refresh {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.spinning {
  animation: spin 0.9s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.head-icon.idle,
.chip.idle {
  color: var(--color-font-label);
  background: var(--color-button-background);
}
.head-icon.bad,
.chip.bad,
.notice.bad {
  color: #e5484d;
  background: color-mix(in srgb, #e5484d 12%, transparent);
}
.notice {
  margin-top: 14px;
  padding: 9px 12px;
  border-radius: 8px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--color-font);
  background: var(--color-primary-background);
}

/* —— 剩余有效期 / 使用额度：大数字 + 进度条 + 说明 —— */
.stats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-top: 16px;
}
.stat {
  display: flex;
  flex-direction: column;
  gap: 7px;
  min-width: 0;
  padding: 14px 16px 13px;
  border: 1px solid var(--color-primary-alpha-900);
  border-radius: 10px;
  background: color-mix(in srgb, var(--color-main-background) 94%, var(--color-primary) 6%);
}
.stat-label,
.stat-sub,
.footnote {
  font-size: 11px;
  color: var(--color-font-label);
}
.stat-label {
  font-size: 12px;
}
.stat-value {
  font-size: 24px;
  font-weight: 680;
  line-height: 1.15;
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
  color: var(--color-font);
}
.stat-value small {
  margin-left: 5px;
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0;
  color: var(--color-font-label);
}
.stat-value.bad {
  color: #e5484d;
}
.bar {
  height: 5px;
  margin-top: 3px;
  border-radius: 999px;
  overflow: hidden;
  background: var(--color-primary-alpha-900);
}
/* 没有进度可画的项（不限额度等）照样占位，两张卡片的说明行才对得齐 */
.bar.placeholder {
  visibility: hidden;
}
.bar > span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--color-primary);
  transition: width 0.4s ease;
}
.bar.idle > span {
  background: var(--color-primary-alpha-500);
}
.bar.bad > span {
  background: #e5484d;
}
.footnote {
  margin-top: 12px;
}
</style>
