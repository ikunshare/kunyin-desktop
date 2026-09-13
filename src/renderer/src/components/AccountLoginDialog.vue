<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import QRCode from 'qrcode'
import { useApi } from '../composables/useApi'
import type { AccountProvider, QQQRStatusEvent, QQWebLoginEvent } from '@common'

const props = defineProps<{ provider: AccountProvider }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'done'): void }>()

const api = useApi()

/**
 * 登录方式（对齐 Android 各平台的入口）：
 * - wy：只有扫码，打开即出码；
 * - qq：先选「扫码 / 网页登录」（QQLoginMethodDialog），网页登录开独立窗口，凭据从 cookie 提取；
 * - kg：先选「扫码 / 手动填写」（KgLoginMethodDialog）。
 */
type Mode = 'choose' | 'qr' | 'web' | 'manual'
const mode = ref<Mode>(props.provider === 'wy' ? 'qr' : 'choose')

const qrImage = ref('') // 二维码图片 data URL
const statusText = ref('')
const busy = ref(false)

// wy/kg 轮询与 qq 事件订阅的清理
let wyTimer: ReturnType<typeof setInterval> | null = null
let kgTimer: ReturnType<typeof setInterval> | null = null
let qqUnsub: (() => void) | null = null
let qqActive = false
let qqWebUnsub: (() => void) | null = null
let qqWebActive = false

function clearWy(): void {
  if (wyTimer) {
    clearInterval(wyTimer)
    wyTimer = null
  }
}
function clearKg(): void {
  if (kgTimer) {
    clearInterval(kgTimer)
    kgTimer = null
  }
}
async function clearQq(): Promise<void> {
  qqUnsub?.()
  qqUnsub = null
  if (qqActive) {
    qqActive = false
    await api.account.qqQrStop()
  }
}
async function clearQqWeb(): Promise<void> {
  qqWebUnsub?.()
  qqWebUnsub = null
  if (qqWebActive) {
    qqWebActive = false
    await api.account.qqWebClose()
  }
}

async function startWyQR(): Promise<void> {
  clearWy()
  qrImage.value = ''
  statusText.value = '正在生成二维码…'
  const info = await api.account.wyQrCreate()
  if (!info) {
    statusText.value = '二维码生成失败，请重试'
    return
  }
  qrImage.value = await QRCode.toDataURL(info.url, { width: 220, margin: 1 })
  statusText.value = '请使用网易云音乐 App 扫码'
  wyTimer = setInterval(async () => {
    const r = await api.account.wyQrPoll(info.unikey)
    if (r.status === 'scanned') statusText.value = '已扫码，请在手机上确认'
    else if (r.status === 'success') {
      statusText.value = '登录成功'
      clearWy()
      emit('done')
    } else if (r.status === 'expired') {
      statusText.value = '二维码已过期，请刷新'
      clearWy()
    } else if (r.status === 'error') {
      statusText.value = '登录出错，请刷新重试'
      clearWy()
    }
  }, 2500)
}

async function startKgQR(): Promise<void> {
  clearKg()
  qrImage.value = ''
  statusText.value = '正在生成二维码…'
  const info = await api.account.kgQrCreate()
  if (!info) {
    statusText.value = '二维码生成失败，请重试'
    return
  }
  qrImage.value = await QRCode.toDataURL(info.url, { width: 220, margin: 1 })
  statusText.value = '请使用酷狗音乐 App 扫码'
  kgTimer = setInterval(async () => {
    const r = await api.account.kgQrPoll(info.ticket)
    if (r.status === 'success') {
      statusText.value = '登录成功'
      clearKg()
      emit('done')
    } else if (r.status === 'expired') {
      statusText.value = '二维码已过期，请刷新'
      clearKg()
    } else if (r.status === 'error') {
      statusText.value = '登录出错，请刷新重试'
      clearKg()
    }
  }, 2000)
}

async function startQqQR(): Promise<void> {
  await clearQq()
  qrImage.value = ''
  statusText.value = '正在生成二维码…'
  qqUnsub = api.account.onQQEvent((e: QQQRStatusEvent) => {
    if (e.status === 'scanned') statusText.value = '已扫码，请在手机上确认'
    else if (e.status === 'confirmed') {
      statusText.value = '登录成功'
      void clearQq()
      emit('done')
    } else if (e.status === 'timeout') {
      statusText.value = '二维码已过期，请刷新'
    } else if (e.status === 'refused') {
      statusText.value = '已取消登录'
    } else if (e.status === 'error') {
      statusText.value = e.message || '登录出错'
    } else {
      statusText.value = '请使用 QQ 音乐 App 扫码'
    }
  })
  const info = await api.account.qqQrStart()
  if (!info) {
    statusText.value = '二维码生成失败，请重试'
    await clearQq()
    return
  }
  qqActive = true
  qrImage.value = info.image
  statusText.value = '请使用 QQ 音乐 App 扫码'
}

/** qq 网页登录：开独立登录窗；用户关窗时主进程自动提取一次并推送结果 */
async function startQqWeb(): Promise<void> {
  await clearQqWeb()
  statusText.value = ''
  qqWebUnsub = api.account.onQQWebEvent((e: QQWebLoginEvent) => {
    if (e.status === 'success') {
      qqWebActive = false
      void clearQqWeb()
      emit('done')
    } else {
      qqWebActive = false
      statusText.value = e.message || '登录窗已关闭，未检测到登录态'
    }
  })
  qqWebActive = true
  await api.account.qqWebOpen()
}

/** 「完成登录」：从登录窗提取凭据；没登录态则保留窗口继续 */
async function finishQqWeb(): Promise<void> {
  if (busy.value) return
  busy.value = true
  try {
    const ok = await api.account.qqWebFinish()
    if (ok) {
      qqWebActive = false
      await clearQqWeb()
      emit('done')
    } else {
      statusText.value = '尚未检测到登录态，请先在登录窗口完成登录'
    }
  } finally {
    busy.value = false
  }
}

async function refreshQR(): Promise<void> {
  if (props.provider === 'wy') await startWyQR()
  else if (props.provider === 'qq') await startQqQR()
  else await startKgQR()
}

// wy 打开即出码；qq/kg 先选方式
onMounted(() => {
  if (mode.value === 'qr') void refreshQR()
})

/** 切到手填：停掉二维码轮询，免得后台继续打接口 */
async function switchToManual(): Promise<void> {
  mode.value = 'manual'
  clearKg()
  clearWy()
  await clearQq()
}
async function switchToQR(): Promise<void> {
  mode.value = 'qr'
  await refreshQR()
}
async function switchToWeb(): Promise<void> {
  mode.value = 'web'
  await clearQq()
  await startQqWeb()
}
/** 回到方式选择（qq/kg） */
async function backToChoose(): Promise<void> {
  mode.value = 'choose'
  statusText.value = ''
  clearKg()
  await clearQq()
  await clearQqWeb()
}

// —— kg 手动 ——
const kgUserid = ref('')
const kgToken = ref('')
const kgMid = ref('')
const kgDfid = ref('')
const advanced = ref(false)

async function saveKg(): Promise<void> {
  if (!kgUserid.value.trim() || !kgToken.value.trim() || busy.value) return
  busy.value = true
  try {
    await api.account.kgSave({
      userid: kgUserid.value.trim(),
      token: kgToken.value.trim(),
      mid: kgMid.value.trim() || undefined,
      dfid: kgDfid.value.trim() || undefined
    })
    emit('done')
  } finally {
    busy.value = false
  }
}

onBeforeUnmount(() => {
  clearWy()
  clearKg()
  void clearQq()
  void clearQqWeb()
  if (props.provider === 'kg') void api.account.kgQrStop()
})

const title =
  props.provider === 'qq' ? 'QQ音乐' : props.provider === 'wy' ? '网易云音乐' : '酷狗音乐'
</script>

<template>
  <div class="mask" @click.self="emit('close')">
    <div class="dialog">
      <div class="head">
        <span class="title">{{ title }}登录</span>
        <button class="close" @click="emit('close')">✕</button>
      </div>

      <!-- 登录方式选择（qq：扫码 / 网页；kg：扫码 / 手动填写） -->
      <div v-if="mode === 'choose'" class="body choose-body">
        <button class="btn" @click="switchToQR">扫码登录</button>
        <button v-if="provider === 'qq'" class="btn" @click="switchToWeb">网页登录</button>
        <button v-else class="btn" @click="switchToManual">手动填写</button>
      </div>

      <!-- 扫码 -->
      <div v-else-if="mode === 'qr'" class="body qr-body">
        <div class="qr-box">
          <img v-if="qrImage" :src="qrImage" alt="二维码" class="qr-img" />
          <div v-else class="qr-loading">生成中…</div>
        </div>
        <p class="status">{{ statusText }}</p>
        <button class="btn" @click="refreshQR">刷新二维码</button>
        <button v-if="provider === 'kg'" class="link" @click="switchToManual">
          扫码不可用？手动填写凭据
        </button>
        <button v-else-if="provider === 'qq'" class="link" @click="switchToWeb">
          扫码不可用？改用网页登录
        </button>
      </div>

      <!-- qq 网页登录：登录在独立窗口里完成，这里只留操作按钮 -->
      <div v-else-if="mode === 'web'" class="body web-body">
        <p class="tip">已打开 QQ 音乐网页登录窗口，请在窗口中完成登录后点击「完成登录」。</p>
        <p class="tip">直接关闭登录窗口也会自动读取登录态。</p>
        <p class="status">{{ statusText }}</p>
        <button class="btn primary" :disabled="busy" @click="finishQqWeb">
          {{ busy ? '读取中…' : '完成登录' }}
        </button>
        <button class="link" @click="startQqWeb">重新打开登录窗口</button>
        <button class="link" @click="backToChoose">返回</button>
      </div>

      <!-- kg 手填凭据（兜底） -->
      <div v-else class="body manual-body">
        <label class="field">
          <span>userid</span>
          <input v-model="kgUserid" type="text" spellcheck="false" />
        </label>
        <label class="field">
          <span>token</span>
          <input v-model="kgToken" type="text" spellcheck="false" />
        </label>
        <button class="link" @click="advanced = !advanced">
          {{ advanced ? '收起' : '高级' }} mid / dfid
        </button>
        <template v-if="advanced">
          <label class="field">
            <span>mid</span>
            <input v-model="kgMid" type="text" spellcheck="false" />
          </label>
          <label class="field">
            <span>dfid</span>
            <input v-model="kgDfid" type="text" spellcheck="false" />
          </label>
        </template>
        <button class="btn primary" :disabled="busy" @click="saveKg">
          {{ busy ? '保存中…' : '保存' }}
        </button>
        <button class="link" @click="switchToQR">返回扫码登录</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mask {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.35);
}
.dialog {
  width: 340px;
  border-radius: 14px;
  background: var(--color-content-background);
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.25);
  overflow: hidden;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
}
.title {
  font-size: 15px;
  font-weight: 600;
  color: var(--color-font);
}
.close {
  color: var(--color-font-label);
  font-size: 14px;
}
.body {
  padding: 16px;
}
.qr-body {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}
.qr-box {
  width: 220px;
  height: 220px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #fff;
  border-radius: 10px;
}
.qr-img {
  width: 220px;
  height: 220px;
}
.qr-loading {
  color: #999;
  font-size: 13px;
}
.status {
  font-size: 13px;
  color: var(--color-font);
  min-height: 18px;
}
.manual-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.choose-body {
  display: flex;
  gap: 10px;
}
.choose-body .btn {
  flex: 1;
  padding: 12px 0;
}
.web-body {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}
.tip {
  font-size: 12px;
  line-height: 1.5;
  color: var(--color-font-label);
  text-align: center;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--color-font-label);
}
.field input {
  padding: 7px 10px;
  border-radius: var(--form-radius);
  font-size: 13px;
  color: var(--color-font);
  background: var(--color-primary-background);
}
.link {
  align-self: flex-start;
  font-size: 12px;
  color: var(--color-primary);
}
.btn {
  padding: 8px 14px;
  border-radius: var(--form-radius);
  font-size: 13px;
  color: var(--color-font);
  background: var(--color-primary-background);
}
.btn.primary {
  color: #fff;
  background: var(--color-primary);
}
.btn:disabled {
  opacity: 0.6;
}
</style>
