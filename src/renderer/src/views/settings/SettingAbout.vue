<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useApi } from '../../composables/useApi'

const api = useApi()
const version = ref('')

onMounted(async () => {
  version.value = await api.app.getVersion()
})
</script>

<template>
  <dt id="about">关于坤音</dt>
  <dd>
    <h3 id="about_version">软件信息</h3>
    <div>
      <p class="p">坤音 KunYin Desktop v{{ version }}</p>
      <p class="p desc">聚合多平台音源的桌面音乐播放器</p>
    </div>
  </dd>
</template>

<style scoped>
.desc {
  font-size: 12px;
  color: var(--color-font-label);
}
</style>
