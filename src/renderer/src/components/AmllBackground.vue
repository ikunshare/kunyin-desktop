<script setup lang="ts">
/**
 * AMLL MeshGradient 流体渐变背景（bg-render 内嵌源码，移植自 @applemusic-like-lyrics/core）。
 *
 * 直接把封面图喂给渲染器：缩样 + 高模糊 + 提艳后生成网格渐变，
 * 换封面时新旧网格按 alpha 交叉淡入，无需自行取色。
 * 替代原自研 PixiBackground（metaball 近似版），观感对齐 Apple Music。
 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { MeshGradientRenderer } from '../bg-render'
import { loadResourceFromUrl } from '../utils/resource'

const props = defineProps<{ cover?: string }>()

const canvas = ref<HTMLCanvasElement | null>(null)
let renderer: MeshGradientRenderer | null = null
// 每次换封面自增，避免异步竞态（旧图回来覆盖新封面）
let applyToken = 0

async function applyCover(src?: string): Promise<void> {
  const token = ++applyToken
  const r = renderer
  if (!r) return
  if (!src) {
    // 无封面：淡出所有网格状态
    await r.setAlbum(undefined)
    return
  }
  try {
    const img = await loadResourceFromUrl(src)
    if (token !== applyToken || renderer !== r) return
    await r.setAlbum(img)
  } catch (e) {
    if (token !== applyToken || renderer !== r) return
    console.warn('[bg-render] 封面载入失败', e)
    // 载入失败（缓存协议 502 等）：淡出到无封面，别让背景停在上一首的颜色上
    await r.setAlbum(undefined)
  }
}

onMounted(() => {
  if (!canvas.value) return
  const r = new MeshGradientRenderer(canvas.value)
  r.setFPS(30)
  // 低渲染比例（0.3）+ CSS 过扫描（scale 1.3）：
  // BHP 网格 patch 交界在强色差下会露出多边形接缝（"弧线"），
  // 过扫描把边缘裁出屏幕、低分辨率渲染把接缝糊化，同时更省性能
  r.setRenderScale(0.3)
  // 没有音频频谱数据，给默认活跃度（AMLL 文档建议无数据时传 1.0）
  r.setLowFreqVolume(1)
  renderer = r
  void applyCover(props.cover)
})

watch(
  () => props.cover,
  (c) => void applyCover(c)
)

onBeforeUnmount(() => {
  applyToken++
  renderer?.dispose()
  renderer = null
})
</script>

<template>
  <canvas ref="canvas" class="amll-bg" />
</template>

<style scoped>
.amll-bg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
  /* 过扫描：网格边缘与 patch 接缝裁出屏幕（配合 renderScale 0.3 糊化） */
  transform: scale(1.3);
}
</style>
