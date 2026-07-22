<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import QRCode from 'qrcode'
import { useApi } from '../composables/useApi'
import type { AccountProvider, QQQRStatusEvent } from '@common'

const props = defineProps<{ provider: AccountProvider }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'done'): void }>()

const api = useApi()

type Tab = 'qr' | 'webview' | 'manual'
const tab = ref<Tab>(props.provider === 'kg' ? 'manual' : 'qr')

const qrImage = ref('') // 二维码图片 data URL
const statusText = ref('')
const busy = ref(false)

// wy 轮询与 qq 事件订阅的清理
let wyTimer: ReturnType<typeof setInterval> | null = null
let qqUnsub: (() => void) | null = null
let qqActive = false

function clearWy(): void {
  if (wyTimer) {
    clearInterval(wyTimer)
    wyTimer = null
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

async function refreshQR(): Promise<void> {
  if (props.provider === 'wy') await startWyQR()
  else if (props.provider === 'qq') await startQqQR()
}

// 切到扫码 tab 时启动对应流程；离开时清理
watch(
  tab,
  async (t, prev) => {
    if (prev === 'qr') {
      clearWy()
      await clearQq()
    }
    if (t === 'qr') await refreshQR()
  },
  { immediate: true }
)

async function webviewLogin(): Promise<void> {
  if (props.provider === 'kg') return
  await api.account.webviewLogin(props.provider)
  // WebView 关闭后由主进程广播 account:changed，这里直接关对话框
  emit('close')
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
  void clearQq()
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

      <div v-if="provider !== 'kg'" class="tabs">
        <button class="tab" :class="{ on: tab === 'qr' }" @click="tab = 'qr'">扫码登录</button>
        <button class="tab" :class="{ on: tab === 'webview' }" @click="tab = 'webview'">
          网页登录
        </button>
      </div>

      <!-- 扫码 -->
      <div v-if="tab === 'qr'" class="body qr-body">
        <div class="qr-box">
          <img v-if="qrImage" :src="qrImage" alt="二维码" class="qr-img" />
          <div v-else class="qr-loading">生成中…</div>
        </div>
        <p class="status">{{ statusText }}</p>
        <button class="btn" @click="refreshQR">刷新二维码</button>
      </div>

      <!-- WebView -->
      <div v-else-if="tab === 'webview'" class="body web-body">
        <p class="web-tip">将打开{{ title }}官网登录页，登录完成后关闭该窗口即自动保存凭据。</p>
        <button class="btn primary" @click="webviewLogin">打开登录页</button>
      </div>

      <!-- kg 手动 -->
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
.tabs {
  display: flex;
  gap: 8px;
  padding: 0 16px 4px;
}
.tab {
  padding: 6px 12px;
  font-size: 13px;
  color: var(--color-font-label);
  border-radius: var(--form-radius);
}
.tab.on {
  color: #fff;
  background: var(--color-primary);
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
.web-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.web-tip {
  font-size: 13px;
  line-height: 1.6;
  color: var(--color-font-label);
}
.manual-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
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
