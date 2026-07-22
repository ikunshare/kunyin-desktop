import type { WindowApi } from '@common'

/** 渲染层统一通过它访问主进程能力（preload 暴露的 window.api）。 */
export function useApi(): WindowApi {
  return window.api
}
