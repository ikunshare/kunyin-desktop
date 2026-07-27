/** 图片/视频资源载入（AMLL core utils/resource.ts 精简移植） */

/** 从 URL 载入图片（isVideo=true 时载入视频），完成前 reject/resolve。
 *  一律走 CORS 模式：kunyin:// 协议注册了 corsEnabled，no-cors 加载会污染画布，
 *  画布一脏 getImageData 就抛 SecurityError（AMLL bg-render 需要采样封面像素）。 */
export function loadResourceFromUrl(
  url: string,
  isVideo = false
): Promise<HTMLImageElement | HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    if (isVideo) {
      const video = document.createElement('video')
      video.crossOrigin = 'anonymous'
      video.preload = 'auto'
      video.muted = true
      video.onloadeddata = () => resolve(video)
      video.onerror = () => reject(new Error(`无法载入视频资源: ${url}`))
      video.src = url
    } else {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error(`无法载入图片资源: ${url}`))
      img.src = url
    }
  })
}

/** 元素已就绪则直接返回，否则等待其加载完成 */
export function loadResourceFromElement(
  el: HTMLImageElement | HTMLVideoElement
): Promise<HTMLImageElement | HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    if (el instanceof HTMLVideoElement) {
      if (el.readyState >= 2) return resolve(el)
      el.onloadeddata = () => resolve(el)
      el.onerror = () => reject(new Error('无法载入视频元素'))
    } else {
      if (el.complete && el.naturalWidth > 0) return resolve(el)
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('无法载入图片元素'))
    }
  })
}
