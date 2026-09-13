<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { LOG_LEVEL_LIST, type LogEntry, type LogFileInfo, type LogLevel } from '@common'
import { useSettingsStore } from '../../stores/settings'
import { useApi } from '../../composables/useApi'
import BaseBtn from '../../components/BaseBtn.vue'
import BaseCheckbox from '../../components/BaseCheckbox.vue'
import BaseSelect from '../../components/BaseSelect.vue'

/**
 * 开发者设置：Release 包里同样可用的排查入口。
 * 线上出问题时的标准流程是「把级别调到调试 → 复现一次 → 导出日志发回来」，
 * 所以这页的每个按钮都要在打包版里真正能按。
 */
const store = useSettingsStore()
const { settings } = storeToRefs(store)
const api = useApi()

const fileInfo = ref<LogFileInfo | null>(null)
const recent = ref<LogEntry[] | null>(null)
const busy = ref(false)
const tip = ref('')

function fmtSize(bytes: number): string {
  if (bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const v = bytes / 1024 ** i
  return `${i === 0 ? v : v.toFixed(2)} ${units[i]}`
}

function fmtTime(ms: number): string {
  const d = new Date(ms)
  const p = (n: number, w = 2): string => String(n).padStart(w, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`
}

async function refreshInfo(): Promise<void> {
  fileInfo.value = await api.log.info().catch(() => null)
}
onMounted(refreshInfo)

function flash(msg: string): void {
  tip.value = msg
  setTimeout(() => (tip.value = ''), 3200)
}

async function setLevel(value: string): Promise<void> {
  await store.update({ developer: { logLevel: value as LogLevel } })
}

async function openDir(): Promise<void> {
  await api.log.openDir()
}

async function dump(): Promise<void> {
  if (busy.value) return
  busy.value = true
  try {
    const path = await api.log.dump()
    flash(path ? `已导出并在文件管理器中定位：${path}` : '导出失败，请检查日志目录是否可写')
    await refreshInfo()
  } finally {
    busy.value = false
  }
}

async function toggleRecent(): Promise<void> {
  if (recent.value) {
    recent.value = null
    return
  }
  recent.value = await api.log.recent(200).catch(() => [])
}

const shortcutLabel = computed(() =>
  navigator.platform.toLowerCase().includes('mac') ? 'Command + F12' : 'Ctrl + F12'
)
</script>

<template>
  <dt id="developer">开发者</dt>

  <dd>
    <h3 id="developer_devtools">开发者工具<span class="hint">正式版同样可用</span></h3>
    <div>
      <p class="p">
        在任意窗口按 <b>{{ shortcutLabel }}</b> 开/关开发者工具（主窗口与桌面歌词窗口都支持，
        以独立窗口打开；如未显示 Console，请选择 Console
        标签）。反馈问题时，把控制台里红色的报错一并截图能省下大量来回确认。
      </p>
      <div class="gap-top">
        <BaseCheckbox
          id="setting_devtools_shortcut"
          :model-value="settings.developer.devToolsShortcut"
          :label="`启用 ${shortcutLabel} 快捷键`"
          @update:model-value="store.update({ developer: { devToolsShortcut: $event as boolean } })"
        />
      </div>
      <div class="p gap-top">
        <BaseBtn min @click="api.log.toggleDevTools()">打开／关闭开发者工具</BaseBtn>
      </div>
    </div>
  </dd>

  <dd>
    <h3 id="developer_log">运行日志</h3>
    <div>
      <p class="p">
        取流、解密、登录、下载、同步这些容易出事的环节都会记录过程。
        遇到问题时先把级别调到「调试」，复现一次再导出日志。
        日志会尽力脱敏常见凭据和链接，但不能保证绝对安全；分享前请检查个人信息、路径及异常内容。
      </p>
      <div class="p gap-top row">
        <span class="label">日志级别</span>
        <BaseSelect
          :model-value="settings.developer.logLevel"
          :list="LOG_LEVEL_LIST"
          @update:model-value="setLevel"
        />
      </div>
      <div class="gap-top">
        <BaseCheckbox
          id="setting_log_to_file"
          :model-value="settings.developer.logToFile"
          label="写入日志文件（按天分文件，自动清理 7 天前的记录）"
          @update:model-value="store.update({ developer: { logToFile: $event as boolean } })"
        />
      </div>
      <p class="p gap-top dim">
        目录：{{ fileInfo?.dir || '—' }}<br />
        占用：{{
          fileInfo ? `${fmtSize(fileInfo.totalBytes)}（${fileInfo.fileCount} 个文件）` : '统计中…'
        }}
      </p>
      <div class="p gap-top btns">
        <BaseBtn min @click="openDir">打开日志目录</BaseBtn>
        <BaseBtn min :disabled="busy" @click="dump">
          {{ busy ? '导出中…' : '导出最近日志' }}
        </BaseBtn>
        <BaseBtn min @click="toggleRecent">
          {{ recent ? '收起最近日志' : '查看最近日志' }}
        </BaseBtn>
      </div>
      <p v-if="tip" class="p tip">{{ tip }}</p>

      <div v-if="recent" class="log-view scroll">
        <p v-if="!recent.length" class="empty">暂无记录（日志级别可能设为了「关闭」）</p>
        <div v-for="(e, i) in recent" :key="i" class="log-line" :class="e.level">
          <span class="log-time">{{ fmtTime(e.time) }}</span>
          <span class="log-scope">{{ e.side }}/{{ e.scope }}</span>
          <span class="log-msg">{{ e.message }}</span>
          <span v-if="e.detail" class="log-detail">{{ e.detail }}</span>
        </div>
      </div>
    </div>
  </dd>
</template>

<style scoped>
.row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.label {
  font-size: 13px;
  color: var(--color-font);
}
.btns {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.dim {
  font-size: 12px;
  color: var(--color-font-label);
  line-height: 1.7;
  word-break: break-all;
}
.tip {
  font-size: 12px;
  color: var(--color-primary);
  word-break: break-all;
}
.log-view {
  margin-top: 12px;
  max-height: 340px;
  overflow: auto;
  padding: 10px;
  border-radius: 8px;
  border: 1px solid var(--color-primary-alpha-900);
  background: var(--color-primary-light-400-alpha-700);
  font-family: Consolas, 'SFMono-Regular', Menlo, monospace;
  font-size: 11px;
  line-height: 1.65;
}
.empty {
  color: var(--color-font-label);
}
.log-line {
  display: flex;
  gap: 7px;
  white-space: pre-wrap;
  word-break: break-all;
  color: var(--color-font);
}
.log-line.warn {
  color: #e6a23c;
}
.log-line.error {
  color: #e5484d;
}
.log-line.debug {
  opacity: 0.68;
}
.log-time {
  flex: none;
  color: var(--color-font-label);
}
.log-scope {
  flex: none;
  font-weight: 600;
  opacity: 0.85;
}
.log-msg {
  flex: none;
}
.log-detail {
  flex: 1;
  min-width: 0;
  opacity: 0.72;
}
</style>
