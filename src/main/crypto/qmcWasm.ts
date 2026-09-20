/**
 * QMC 流密码的 wasm 后端（native/qmc-wasm 编译产物的 JS 封装）。
 *
 * 只承担「每字节都要跑」的两条热路径（map / RC4）；ekey 的 base64+TEA 解密
 * 每首歌只跑一次，留在 mflac.ts 里用 JS 做。
 *
 * 失败一律返回 null，由 mflac.ts 回退到纯 JS 实现 —— 解密器是播放链路的必经环节，
 * 任何一处 wasm 不可用都不能让播放挂掉。
 *
 * 刻意不 import core/logger：那条链会 `import { app } from 'electron'`，
 * 引进来这个模块就只能在 Electron 里跑，tools/qmc.test.mjs 的纯 Node 交叉校验就没了。
 * 状态通过 qmcWasmStatus() 暴露，由 src/main/index.ts 启动时记一条日志。
 */
import type { AudioDecryptor } from './mflac'
import { QMC_WASM_BASE64 } from './qmcWasmBinary'

interface QmcExports {
  memory: WebAssembly.Memory
  io_ptr(): number
  io_cap(): number
  key_ptr(): number
  key_cap(): number
  map_init(keyLen: number): void
  map_decrypt(len: number, fileOffset: number): void
  rc4_init(keyLen: number): void
  rc4_decrypt(len: number, fileOffset: number): void
}

/**
 * 模块编译一次全局复用；实例每个解密器一份 —— key/keystream 是 wasm 侧的模块级
 * static，共用实例会让并发的播放流与下载任务互相踩。实例化只有几微秒。
 *
 * 同步编译：主进程是 Node 环境，没有浏览器主线程那条 4KB 同步编译限制，模块本身
 * 才 ~2.6KB。同步换来 createAudioDecryptor 保持同步签名，上面一整条调用链
 * （protocol.handle / 下载器）都不用改成异步。
 */
let cachedModule: WebAssembly.Module | null | undefined
let failReason = ''

function getModule(): WebAssembly.Module | null {
  if (cachedModule !== undefined) return cachedModule
  try {
    cachedModule = new WebAssembly.Module(Buffer.from(QMC_WASM_BASE64, 'base64'))
  } catch (e) {
    cachedModule = null
    failReason = e instanceof Error ? e.message : String(e)
  }
  return cachedModule
}

/** 诊断用：wasm 后端是否可用；不可用时给出原因。启动时记一条日志。 */
export function qmcWasmStatus(): { available: boolean; reason?: string } {
  const ok = getModule() !== null
  return ok ? { available: true } : { available: false, reason: failReason || '未知原因' }
}

class WasmCipher implements AudioDecryptor {
  /**
   * 不缓存 `new Uint8Array(memory.buffer)` 之外的视图：memory.grow 会让旧 ArrayBuffer
   * detach。这里 wasm 侧全是编译期固定的 static、没有分配器，内存不会 grow，
   * 所以建一次即可 —— 但别把这个前提套到会 grow 的模块上。
   */
  private readonly mem: Uint8Array
  private readonly ioPtr: number
  private readonly ioCap: number
  private readonly decryptFn: (len: number, fileOffset: number) => void

  constructor(exports: QmcExports, rawKey: Uint8Array, kind: 'map' | 'rc4') {
    this.mem = new Uint8Array(exports.memory.buffer)
    this.ioPtr = exports.io_ptr()
    this.ioCap = exports.io_cap()

    this.mem.set(rawKey, exports.key_ptr())
    if (kind === 'map') {
      exports.map_init(rawKey.length)
      this.decryptFn = exports.map_decrypt
    } else {
      exports.rc4_init(rawKey.length)
      this.decryptFn = exports.rc4_decrypt
    }
  }

  decrypt(chunk: Buffer, fileOffset: number): Buffer {
    const out = Buffer.allocUnsafe(chunk.length)
    // 流密码按绝对偏移寻址、无跨块状态，超过 IO 窗口的大块直接切开分批喂。
    for (let pos = 0; pos < chunk.length; pos += this.ioCap) {
      const block = Math.min(chunk.length - pos, this.ioCap)
      this.mem.set(chunk.subarray(pos, pos + block), this.ioPtr)
      this.decryptFn(block, fileOffset + pos)
      out.set(this.mem.subarray(this.ioPtr, this.ioPtr + block), pos)
    }
    return out
  }
}

/** wasm 侧单次 decrypt 的窗口大小（整文件解密按它分块读写）。拿不到 wasm 时返回 0。 */
export function wasmIoCap(): number {
  const mod = getModule()
  if (!mod) return 0
  try {
    return (new WebAssembly.Instance(mod, {}).exports as unknown as QmcExports).io_cap()
  } catch {
    return 0
  }
}

/**
 * 用解出的原始 key 造一个 wasm 解密器。
 * wasm 不可用、或 key 超出 wasm 侧静态缓冲上限时返回 null（调用方回退纯 JS）。
 */
export function createWasmCipher(rawKey: Uint8Array, kind: 'map' | 'rc4'): AudioDecryptor | null {
  const mod = getModule()
  if (!mod) return null
  try {
    const exports = new WebAssembly.Instance(mod, {}).exports as unknown as QmcExports
    if (rawKey.length === 0 || rawKey.length > exports.key_cap()) return null
    return new WasmCipher(exports, rawKey, kind)
  } catch {
    return null
  }
}
