/**
 * 音频解码 wasm（dolby / av3a，都是 wasi-sdk 编的 wasm32-wasip1 reactor）共用的 WASI 系统调用桩。
 *
 * 解码器用不到文件、环境变量：一律「没有」；只有 libc 初始化会问环境变量个数（报错它会直接退出，
 * 所以要老实答 0）。日志输出在各自的 shim / 静音头里已经掐掉，fd_write 兜底吞掉。
 * 没列出的调用一律回 ENOSYS。
 *
 * 不 import electron，tools/ 下的回归测试直接跑。
 */
import { randomFillSync } from 'node:crypto'

const ERRNO_BADF = 8
const ERRNO_NOSYS = 52

/** @param label 出现在 proc_exit 异常里，便于分辨是哪个模块 */
export function wasiImports(
  memory: () => WebAssembly.Memory,
  label: string
): WebAssembly.ModuleImports {
  const view = (): DataView => new DataView(memory().buffer)
  const known: WebAssembly.ModuleImports = {
    environ_sizes_get: (countPtr: number, sizePtr: number) => {
      view().setUint32(countPtr, 0, true)
      view().setUint32(sizePtr, 0, true)
      return 0
    },
    environ_get: () => 0,
    clock_time_get: (_id: number, _precision: bigint, outPtr: number) => {
      view().setBigUint64(outPtr, process.hrtime.bigint(), true)
      return 0
    },
    random_get: (ptr: number, len: number) => {
      randomFillSync(new Uint8Array(memory().buffer, ptr, len))
      return 0
    },
    fd_write: (_fd: number, iovs: number, iovsLen: number, nwrittenPtr: number) => {
      const v = view()
      let n = 0
      for (let i = 0; i < iovsLen; i++) n += v.getUint32(iovs + i * 8 + 4, true)
      v.setUint32(nwrittenPtr, n, true)
      return 0
    },
    fd_prestat_get: () => ERRNO_BADF,
    proc_exit: (code: number) => {
      throw new Error(`${label} wasm 调用了 proc_exit(${code})`)
    }
  }
  return new Proxy(known, { get: (t, name: string) => t[name] ?? (() => ERRNO_NOSYS) })
}
