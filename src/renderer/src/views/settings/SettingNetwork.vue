<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import type { ProxyStatus } from '@common'
import { useSettingsStore } from '../../stores/settings'
import BaseCheckbox from '../../components/BaseCheckbox.vue'

const store = useSettingsStore()
const { settings } = storeToRefs(store)

// 代理探活结果：配了但端口不可达时主进程会回落直连，这里如实告知
// （否则用户只会看到封面 502 / 播放失败，完全联想不到是代理）
const proxy = ref<ProxyStatus | null>(null)

async function refreshProxyStatus(): Promise<void> {
  proxy.value = await window.api.settings.proxyStatus().catch(() => null)
}

onMounted(refreshProxyStatus)
// 改完主机/端口/开关后主进程会重新探活，稍等再取（探活超时 1.5s）
watch(
  () => [
    settings.value.network.proxy.enable,
    settings.value.network.proxy.host,
    settings.value.network.proxy.port
  ],
  () => setTimeout(refreshProxyStatus, 1800)
)
</script>

<template>
  <dt id="network">网络设置</dt>
  <dd>
    <h3 id="network_proxy">代理</h3>
    <div>
      <BaseCheckbox
        id="setting_proxy_enable"
        :model-value="settings.network.proxy.enable"
        label="启用代理（HTTP 代理，作用于在线播放与接口请求）"
        @update:model-value="store.update({ network: { proxy: { enable: $event as boolean } } })"
      />
      <div v-if="settings.network.proxy.enable" class="gap-top proxy-form">
        <input
          class="text host"
          type="text"
          placeholder="主机，如 127.0.0.1"
          spellcheck="false"
          :value="settings.network.proxy.host"
          @change="
            store.update({
              network: { proxy: { host: ($event.target as HTMLInputElement).value.trim() } }
            })
          "
        />
        <input
          class="text port"
          type="number"
          min="0"
          max="65535"
          placeholder="端口"
          :value="settings.network.proxy.port || ''"
          @change="
            store.update({
              network: { proxy: { port: Number(($event.target as HTMLInputElement).value) } }
            })
          "
        />
      </div>
      <p v-if="proxy?.enabled && !proxy.active" class="hint warn">
        {{ proxy.reason }}——代理不可用时会连不上封面与播放地址，请确认代理软件已启动。
      </p>
      <p v-else-if="proxy?.active" class="hint ok">代理已生效。</p>
    </div>
  </dd>
</template>

<style scoped>
.proxy-form {
  display: flex;
  gap: 8px;
}
.text {
  padding: 6px 10px;
  border-radius: var(--form-radius);
  font-size: 13px;
  color: var(--color-font);
  background-color: var(--color-primary-background);
}
.host {
  width: 200px;
}
.port {
  width: 90px;
}
.hint {
  margin-top: 8px;
  font-size: 12px;
  line-height: 1.5;
}
.hint.warn {
  color: #d9534f;
}
.hint.ok {
  color: var(--color-font-label);
}
</style>
