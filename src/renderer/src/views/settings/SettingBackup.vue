<script setup lang="ts">
import { ref } from 'vue'
import { useSettingsStore } from '../../stores/settings'
import { useApi } from '../../composables/useApi'
import BaseBtn from '../../components/BaseBtn.vue'

const store = useSettingsStore()
const api = useApi()

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
</script>

<template>
  <dt id="backup">备份与恢复</dt>
  <dd>
    <div class="p">
      <BaseBtn min @click="exportFullBackup">导出完整备份</BaseBtn>
      <BaseBtn min class="gap-left" @click="restoreBackup">恢复备份</BaseBtn>
    </div>
    <div class="p gap-top">
      <BaseBtn min @click="importLxFile">导入 LX 歌单（.lxmc）</BaseBtn>
    </div>
    <p v-if="backupMsg" class="msg">{{ backupMsg }}</p>
  </dd>
</template>

<style scoped>
.msg {
  padding: 8px 0 0;
  font-size: 12px;
  color: var(--color-font-label);
}
</style>
