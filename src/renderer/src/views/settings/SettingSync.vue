<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useSettingsStore } from '../../stores/settings'
import { useApi } from '../../composables/useApi'
import type { AppSettings, SyncStatusSnapshot } from '@common'
import BaseBtn from '../../components/BaseBtn.vue'
import BaseCheckbox from '../../components/BaseCheckbox.vue'
import BaseSelect from '../../components/BaseSelect.vue'

const store = useSettingsStore()
const { settings } = storeToRefs(store)
const api = useApi()

const syncStatus = ref<SyncStatusSnapshot>({ status: 'idle', error: null, serverName: '' })
let syncUnsub: (() => void) | null = null

const SYNC_MODE_LIST = [
  { id: 'merge_local_remote', label: '合并（本地优先）' },
  { id: 'merge_remote_local', label: '合并（远端优先）' },
  { id: 'overwrite_local_remote', label: '用本地覆盖远端' },
  { id: 'overwrite_remote_local', label: '用远端覆盖本地' }
]
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

function setSyncMode(id: string): void {
  void store.update({ sync: { syncMode: id as AppSettings['sync']['syncMode'] } })
}

onMounted(() => {
  void api.sync.status().then((s) => (syncStatus.value = s))
  syncUnsub = api.sync.onStatus((s) => (syncStatus.value = s))
})
onUnmounted(() => syncUnsub?.())
</script>

<template>
  <dt id="sync">数据同步</dt>
  <dd>
    <div>
      <BaseCheckbox
        id="setting_sync_enable"
        :model-value="settings.sync.enable"
        label="启用 LX 同步（与手机端/其他设备同步收藏与歌单）"
        @update:model-value="store.update({ sync: { enable: $event as boolean } })"
      />
    </div>
    <template v-if="settings.sync.enable">
      <div class="gap-top row">
        <span class="row-label">服务器地址</span>
        <input
          class="text"
          type="text"
          spellcheck="false"
          :value="settings.sync.serverUrl"
          @change="
            store.update({ sync: { serverUrl: ($event.target as HTMLInputElement).value.trim() } })
          "
        />
      </div>
      <div class="gap-top row">
        <span class="row-label">激活卡密 (CDK)</span>
        <input
          class="text"
          type="text"
          spellcheck="false"
          :value="settings.sync.cdk"
          @change="
            store.update({ sync: { cdk: ($event.target as HTMLInputElement).value.trim() } })
          "
        />
      </div>
      <div class="gap-top row">
        <span class="row-label">设备名</span>
        <input
          class="text"
          type="text"
          spellcheck="false"
          :value="settings.sync.deviceName"
          @change="
            store.update({ sync: { deviceName: ($event.target as HTMLInputElement).value } })
          "
        />
      </div>
      <div class="gap-top row">
        <span class="row-label">同步模式</span>
        <BaseSelect
          :model-value="settings.sync.syncMode"
          :list="SYNC_MODE_LIST"
          @update:model-value="setSyncMode"
        />
      </div>
      <div class="gap-top">
        <BaseCheckbox
          id="setting_sync_auto"
          :model-value="settings.sync.autoConnect"
          label="启动时自动连接"
          @update:model-value="store.update({ sync: { autoConnect: $event as boolean } })"
        />
      </div>
      <div class="gap-top row">
        <span class="row-label">连接状态</span>
        <span class="status" :class="{ ok: syncStatus.status === 'connected' }">
          {{ SYNC_STATUS_LABELS[syncStatus.status]
          }}{{ syncStatus.serverName ? ` · ${syncStatus.serverName}` : '' }}
          <template v-if="syncStatus.status === 'failed' && syncStatus.error">
            （{{ syncStatus.error }}）
          </template>
        </span>
        <BaseBtn
          v-if="syncStatus.status === 'idle' || syncStatus.status === 'failed'"
          min
          class="primary"
          @click="syncConnect"
        >
          连接
        </BaseBtn>
        <BaseBtn v-else min @click="syncDisconnect">断开</BaseBtn>
      </div>
    </template>
  </dd>
</template>

<style scoped>
.row {
  display: flex;
  align-items: center;
  gap: 12px;
}
.row-label {
  flex: none;
  width: 96px;
  font-size: 13px;
  color: var(--color-font);
}
.text {
  width: 260px;
  padding: 6px 10px;
  border-radius: var(--form-radius);
  font-size: 13px;
  color: var(--color-font);
  background-color: var(--color-primary-background);
}
.status {
  font-size: 12px;
  color: var(--color-font-label);
}
.status.ok {
  color: var(--color-primary);
}
.primary {
  color: #fff;
  background: var(--color-primary);
}
</style>
