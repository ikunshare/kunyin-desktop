<script setup lang="ts">
/** 软件更新（对应 lx-music-desktop 的「软件更新」）。原先并在「关于」页里，按 LX 的分类拆出来。 */
import { onMounted, onUnmounted, ref } from 'vue'
import { useApi } from '../../composables/useApi'
import type { UpdaterEvent } from '@common'
import BaseBtn from '../../components/BaseBtn.vue'

const api = useApi()

const version = ref('')
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

onMounted(async () => {
  version.value = await api.app.getVersion()
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
  <dt id="update">软件更新</dt>
  <dd>
    <div>
      <p class="p">当前版本：v{{ version }}</p>
      <div class="p gap-top row">
        <BaseBtn v-if="updateReady" min class="primary" @click="installUpdate">重启安装</BaseBtn>
        <BaseBtn v-else min :disabled="updateChecking" @click="checkUpdate">
          {{ updateChecking ? '检查中…' : '检查更新' }}
        </BaseBtn>
        <span v-if="updateMsg" class="msg">{{ updateMsg }}</span>
      </div>
      <p class="p tip">启动时会静默检查一次；更新包由 GitHub Releases 分发。</p>
    </div>
  </dd>
</template>

<style scoped>
.row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.primary {
  color: #fff;
  background: var(--color-primary);
}
.msg,
.tip {
  font-size: 12px;
  color: var(--color-font-label);
}
.tip {
  margin-top: 10px;
}
</style>
