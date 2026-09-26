<script setup lang="ts">
import { onMounted, ref, version as vueVersion } from 'vue'
import { useApi } from '../../composables/useApi'
import { OSS_SECTIONS } from './ossLicenses'

const api = useApi()
const version = ref('')

onMounted(async () => {
  version.value = await api.app.getVersion()
})

const REPOS = [
  { label: '坤音桌面版', url: 'https://github.com/ikunshare/kunyin-desktop' },
  { label: '坤音安卓版', url: 'https://github.com/ikunshare/kunyin' }
]

// Electron / Chromium 取运行时的真值（preload 暴露的 process.versions），Vue 取打进包的那份；
// Vite / electron-vite 只在构建期存在，由 electron.vite.config.ts 的 define 注入
const { versions } = window.electron.process
const TECH_VERSIONS = [
  { name: 'Electron', version: versions.electron },
  { name: 'Chromium', version: versions.chrome },
  { name: 'Vue', version: vueVersion },
  { name: 'Vite', version: import.meta.env.VITE_VERSION },
  { name: 'electron-vite', version: import.meta.env.ELECTRON_VITE_VERSION }
]

// 列表由 scripts/gen-licenses.mjs 生成，只收在线许可证核实得到的项目
const ossTotal = OSS_SECTIONS.reduce((n, s) => n + s.items.length, 0)
</script>

<template>
  <dt id="about">关于坤音</dt>
  <dd>
    <h3 id="about_version">软件信息</h3>
    <div>
      <p class="p">坤音 KunYin Desktop v{{ version }}</p>
      <p class="p desc">聚合多平台音源的桌面音乐播放器</p>
      <div class="kv gap-top">
        <template v-for="repo in REPOS" :key="repo.url">
          <span class="k">{{ repo.label }}</span>
          <a class="link" :href="repo.url" target="_blank">{{
            repo.url.replace('https://', '')
          }}</a>
        </template>
      </div>
    </div>
  </dd>
  <dd>
    <h3 id="about_tech">技术栈</h3>
    <div class="kv">
      <template v-for="t in TECH_VERSIONS" :key="t.name">
        <span class="k">{{ t.name }}</span>
        <span class="num">{{ t.version || '未知' }}</span>
      </template>
    </div>
  </dd>
  <dd>
    <h3 id="about_license">
      开源许可<span class="hint">共 {{ ossTotal }} 个项目，点右侧的许可证查看全文</span>
    </h3>
    <section v-for="section in OSS_SECTIONS" :key="section.title" class="oss-section">
      <h4>{{ section.title }}</h4>
      <ul class="oss-list">
        <li v-for="item in section.items" :key="item.name" class="oss-item">
          <div class="oss-info">
            <a class="oss-name" :href="item.url" target="_blank">{{ item.name }}</a>
            <span v-if="item.indirect" class="oss-tag">间接</span>
            <p v-if="item.usage || item.packages" class="oss-sub">
              {{ item.usage ?? item.packages?.join(' · ') }}
            </p>
          </div>
          <a
            class="oss-license"
            :href="item.licenseUrl"
            target="_blank"
            :title="`${item.name} 的许可证全文`"
          >
            {{ item.license }}
          </a>
        </li>
      </ul>
    </section>
    <!-- 署名：用了什么、许可证是什么、源码在哪（见 native/dolby-wasm/README.md） -->
    <p class="p desc gap-top">
      杜比全景声的播放使用了
      <a href="https://github.com/librempeg/librempeg" target="_blank">LibreMPEG</a>
      的 AC-3 / E-AC-3 / AC-4 解码器，按
      <a href="https://www.gnu.org/licenses/gpl-3.0.html" target="_blank">GPL 3.0 或更高版本</a>
      授权，许可证全文随安装包附带（licenses/LibreMPEG-GPL-3.0.txt）。所用源码为
      <a
        href="https://github.com/librempeg/librempeg/tree/9c00336e26e45ed1274c9693382b1b1441ccaf6a"
        target="_blank"
      >
        LibreMPEG 9c00336e26
      </a>
      ，构建脚本见本项目仓库的 native/dolby-wasm。
    </p>
  </dd>
</template>

<style scoped>
.desc {
  font-size: 12px;
  color: var(--color-font-label);
}
.desc a,
.link {
  color: var(--color-primary);
}
.link:hover {
  text-decoration: underline;
}

.kv {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 6px 20px;
  font-size: 13px;
  line-height: 1.5;
}
.k {
  color: var(--color-font-label);
}
.num {
  font-variant-numeric: tabular-nums;
}

.oss-section + .oss-section {
  margin-top: 16px;
}
.oss-section h4 {
  margin: 0 0 6px;
  font-size: 11px;
  font-weight: 600;
  color: var(--color-font-label);
}
.oss-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 2px 12px;
}
.oss-item {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 7px 10px;
  border-radius: 8px;
  transition: background-color 0.18s ease;
}
.oss-item:hover {
  background: var(--color-primary-background-hover);
}
.oss-info {
  min-width: 0;
}
.oss-name {
  font-size: 13px;
  font-weight: 550;
  color: var(--color-font);
}
.oss-name:hover {
  color: var(--color-primary);
  text-decoration: underline;
}
.oss-tag {
  display: inline-block;
  white-space: nowrap;
  margin-left: 6px;
  padding: 0 5px;
  border-radius: 4px;
  font-size: 10px;
  line-height: 16px;
  vertical-align: 1px;
  color: var(--color-font-label);
  background: var(--color-button-background);
}
.oss-sub {
  margin-top: 2px;
  font-size: 11px;
  line-height: 1.45;
  color: var(--color-font-label);
  overflow-wrap: anywhere;
}
.oss-license {
  flex: none;
  max-width: 45%;
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 11px;
  line-height: 1.45;
  text-align: center;
  color: var(--color-primary);
  background: var(--color-primary-background);
  transition: background-color 0.18s ease;
}
.oss-license:hover {
  background: var(--color-primary-background-active);
}
</style>
