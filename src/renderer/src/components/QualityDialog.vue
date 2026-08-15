<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { QUALITY_IDS, QUALITY_NAMES, type MusicItem } from '@common'
import { useSettingsStore } from '../stores/settings'
import { useDownloadStore } from '../stores/download'

// 下载音质选择弹窗（LX DownloadModal / DownloadMultipleModal 风格：
// 居中标题 + 竖排音质按钮，点选即开始下载）。
// - 单曲：只列该曲可用的音质，显示文件大小；
// - 批量：列全部档位（逐首回退到各自可用的最接近档位，由主进程 pickQuality 处理）。
// 设置里的「优先下载音质」以（优先）标注。
const props = defineProps<{
  items: MusicItem[]
  listName?: string
  /** 整专下载：所有曲目保存到该子目录（专辑名） */
  subDir?: string
  /** 整专下载：按曲目顺序给文件名加两位轨号（配合「文件名前缀轨号」设置） */
  numbered?: boolean
  /** 自定义标题（纯音质选择模式用，例如「下载 N 张专辑」；items 为空时仅选档不下载） */
  label?: string
}>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'added', qualityId: string): void }>()

const download = useDownloadStore()
const { settings } = storeToRefs(useSettingsStore())

const isBatch = computed(() => props.items.length > 1)
const preferred = computed(() => settings.value.download.preferredQuality)

interface QualityOption {
  id: string
  label: string
}

const options = computed<QualityOption[]>(() => {
  const ladder = [...QUALITY_IDS].reverse() // 高 → 低
  const suffix = (id: string, size?: number): string =>
    `${size ? ` - ${fmtSize(size)}` : ''}${id === preferred.value ? '（优先）' : ''}`
  if (isBatch.value) {
    return ladder.map((id) => ({ id, label: `${QUALITY_NAMES[id]}${suffix(id)}` }))
  }
  const item = props.items[0]
  const out: QualityOption[] = []
  for (const id of ladder) {
    const q = item?.qualities[id]
    if (!q) continue
    out.push({ id, label: `${q.name || QUALITY_NAMES[id]}${suffix(id, q.filesize)}` })
  }
  // 防御：qualities 为空时给全档位（主进程会再回退）
  return out.length ? out : ladder.map((id) => ({ id, label: `${QUALITY_NAMES[id]}${suffix(id)}` }))
})

function fmtSize(bytes: number): string {
  if (!bytes) return ''
  return `${(bytes / 1024 / 1024).toFixed(1)}M`
}

function pick(id: string): void {
  const base = {
    listName: props.listName,
    subDir: props.subDir
  }
  props.items.forEach((item, i) => {
    void download.add(item, id, {
      ...base,
      trackNumber: props.numbered ? i + 1 : undefined
    })
  })
  emit('added', id)
  emit('close')
}
</script>

<template>
  <div class="mask" @click.self="emit('close')">
    <div class="dialog">
      <h2 class="title">
        <template v-if="label">{{ label }}</template>
        <template v-else-if="isBatch">已选 {{ items.length }} 首歌曲</template>
        <template v-else>{{ items[0]?.title }}<br />{{ items[0]?.artist }}</template>
      </h2>
      <div class="btns">
        <button v-for="o in options" :key="o.id" class="qbtn" @click="pick(o.id)">
          {{ o.label }}
        </button>
      </div>
      <div class="foot">
        <button class="cancel" @click="emit('close')">取消</button>
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
  width: 300px;
  max-width: 90vw;
  padding: 15px;
  border-radius: 8px;
  background: var(--color-content-background);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.28);
}
.title {
  font-size: 13px;
  line-height: 1.6;
  text-align: center;
  color: var(--color-font);
  word-break: break-all;
}
.btns {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 15px;
  max-height: 50vh;
  overflow-y: auto;
}
.qbtn {
  flex: none;
  padding: 9px 12px;
  border-radius: var(--form-radius);
  font-size: 13px;
  color: var(--color-button-font);
  background: var(--color-button-background);
  transition: background-color 0.2s ease;
}
.qbtn:hover {
  background: var(--color-button-background-hover);
}
.qbtn:active {
  background: var(--color-button-background-active);
}
.foot {
  display: flex;
  justify-content: center;
  margin-top: 15px;
}
.cancel {
  padding: 6px 20px;
  border-radius: var(--form-radius);
  font-size: 12.5px;
  color: var(--color-font-label);
  transition:
    color 0.2s ease,
    background-color 0.2s ease;
}
.cancel:hover {
  color: var(--color-font);
  background: var(--color-button-background-hover);
}
</style>
