import { ref, watch, type Ref } from 'vue'

/**
 * 从封面提取主色调（用于播放页流体背景）。
 * canvas 缩小采样 + 轻度增饱和，近似 Android 端「封面 → mesh 顶点色」的预处理。
 * 对离线渐变封面与真实封面均可用。
 */
export function useCoverColors(cover: Ref<string | undefined>): Ref<string[]> {
  const colors = ref<string[]>(['#3a4654', '#232a34', '#4a5568', '#1a2029'])

  watch(
    cover,
    (url) => {
      if (!url) return
      extract(url)
        .then((c) => {
          if (c.length) colors.value = c
        })
        .catch(() => {})
    },
    { immediate: true }
  )

  return colors
}

function extract(url: string): Promise<string[]> {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const n = 8
      const canvas = document.createElement('canvas')
      canvas.width = n
      canvas.height = n
      const ctx = canvas.getContext('2d')
      if (!ctx) return resolve([])
      ctx.drawImage(img, 0, 0, n, n)
      let data: Uint8ClampedArray
      try {
        data = ctx.getImageData(0, 0, n, n).data
      } catch {
        return resolve([])
      }
      const pts: Array<[number, number]> = [
        [1, 1],
        [6, 1],
        [3, 4],
        [1, 6],
        [6, 6]
      ]
      const cols = pts.map(([x, y]) => {
        const i = (y * n + x) * 4
        return boost(data[i], data[i + 1], data[i + 2])
      })
      resolve(cols)
    }
    img.onerror = () => resolve([])
    img.src = url
  })
}

/** 温和增饱和，让流体背景更鲜活 */
function boost(r: number, g: number, b: number): string {
  const avg = (r + g + b) / 3
  const f = 1.35
  const c = (v: number): number => Math.max(0, Math.min(255, Math.round(avg + (v - avg) * f)))
  return `rgb(${c(r)}, ${c(g)}, ${c(b)})`
}
