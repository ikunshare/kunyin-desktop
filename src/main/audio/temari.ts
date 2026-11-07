import { TEMARI_WASM_BASE64 } from './temariWasmBinary'

interface TemariExports {
  memory: WebAssembly.Memory
  tmpl_from_json(ptr: number, len: number): number
  tmpl_destroy(handle: number): void
  decrypt_sample_ffi(handle: number, sample: number, len: number, out: number): number
}

let cachedModule: WebAssembly.Module | undefined

function getModule(): WebAssembly.Module {
  if (cachedModule === undefined) {
    cachedModule = new WebAssembly.Module(Buffer.from(TEMARI_WASM_BASE64, 'base64'))
  }
  return cachedModule
}

export class TemariTemplate {
  private readonly exports: TemariExports
  private readonly handle: number
  private bump = 0x80000
  private scratch = this.bump
  private closed = false

  constructor(json: string) {
    const instance = new WebAssembly.Instance(getModule(), {
      env: {
        abort: () => {
          throw new Error('Temari WASM abort')
        }
      }
    })
    this.exports = instance.exports as unknown as TemariExports
    const bytes = Buffer.from(json, 'utf8')
    const ptr = this.alloc(bytes)
    this.handle = this.exports.tmpl_from_json(ptr, bytes.length)
    if (!this.handle) throw new Error('Temari 密钥模板无效')
    this.bump = (this.bump + 15) & ~15
    this.scratch = this.bump
  }

  private alloc(bytes: Uint8Array): number {
    const needed = this.bump + bytes.length
    const memory = this.exports.memory
    if (needed > memory.buffer.byteLength) {
      const pages = Math.ceil((needed - memory.buffer.byteLength) / 65536)
      memory.grow(pages)
    }
    const ptr = this.bump
    new Uint8Array(memory.buffer, ptr, bytes.length).set(bytes)
    this.bump = ptr + ((bytes.length + 15) & ~15)
    return ptr
  }

  decrypt(sample: Uint8Array): Uint8Array {
    if (this.closed) throw new Error('Temari 模板已关闭')
    const length = sample.length & ~15
    const output = new Uint8Array(sample)
    if (length === 0) return output
    const start = this.scratch
    this.bump = start
    try {
      const input = this.alloc(sample.subarray(0, length))
      const plain = this.alloc(new Uint8Array(length))
      const written = this.exports.decrypt_sample_ffi(this.handle, input, length, plain)
      if (written !== length) throw new Error('Temari 样本解密失败')
      output.set(new Uint8Array(this.exports.memory.buffer, plain, length), 0)
      return output
    } finally {
      this.bump = start
    }
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.exports.tmpl_destroy(this.handle)
  }
}
