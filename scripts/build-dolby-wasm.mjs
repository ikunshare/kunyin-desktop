/**
 * 编译 native/dolby-wasm（LibreMPEG 的 AC-3 / E-AC-3 / AC-4 解码器）并把产物内联成 TS 模块（base64）。
 *
 * 跟 build-wasm.mjs 同一个思路：产物 src/main/audio/dolbyWasmBinary.ts **已提交进仓库**，
 * `npm run build` 和 CI 都不需要这套工具链。只有升级 LibreMPEG 或改了 shim.c 才要跑一次。
 *
 * LibreMPEG 的 configure/make 只能在类 Unix 环境里跑：Linux / macOS 直接用 bash，
 * Windows 走 WSL。源码包在宿主机这边下载并校验 sha256——WSL 里常常解析不了外网域名。
 *
 * 前置：Linux / macOS 需要 bash、make、tar、xz；Windows 需要装好一个 WSL 发行版（同上）。
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const nativeDir = join(root, 'native', 'dolby-wasm')
const cacheDir = join(nativeDir, '.cache')
const wasmPath = join(cacheDir, 'dolby.wasm')
const outPath = join(root, 'src', 'main', 'audio', 'dolbyWasmBinary.ts')

// 版本与 build.sh 顶部的 LIBREMPEG_COMMIT / WASI_SDK 保持一致。
// 提交跟 Zencok/mpv-libre-runtime 当时的 Release 对齐（那边在 CI 里验过 AC-4 解码）。
const LIBREMPEG_COMMIT = '9c00336e26e45ed1274c9693382b1b1441ccaf6a'
const LIBREMPEG = {
  file: `librempeg-${LIBREMPEG_COMMIT}.tar.gz`,
  url: `https://github.com/librempeg/librempeg/archive/${LIBREMPEG_COMMIT}.tar.gz`,
  sha256: '365c67e8823a41d8ab7e4d0e1345e375c080300caf9c6173ee0997325f520952'
}
const WASI_SDK = '34.0'
/** 已核对过的 wasi-sdk 包；其它平台照样能编，只是先打印算出来的 sha256 供补登 */
const WASI_SHA256 = {
  'x86_64-linux': 'b761e3a0721dbae9c09a0059e5fdb2bf917d1b4a8a7b430fb3b5aafb0984b2c4'
}

/** 真正跑 build.sh 的那台（Windows 上是 WSL 里的 Linux）要哪个 wasi-sdk 包 */
function buildHostArch() {
  const cpu = process.arch === 'arm64' ? 'arm64' : 'x86_64'
  if (process.platform === 'darwin') return `${cpu}-macos`
  return `${cpu}-linux`
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

async function fetchVerified(file, url, expected) {
  const dest = join(cacheDir, file)
  if (!existsSync(dest)) {
    console.log(`[build-dolby-wasm] 下载 ${url}`)
    const resp = await fetch(url)
    if (!resp.ok) throw new Error(`下载失败 ${resp.status}：${url}`)
    writeFileSync(dest, Buffer.from(await resp.arrayBuffer()))
  }
  const actual = sha256(dest)
  if (expected && actual !== expected) {
    throw new Error(`${file} 的 sha256 不符：\n  期望 ${expected}\n  实际 ${actual}\n删掉它重下`)
  }
  if (!expected) console.warn(`[build-dolby-wasm] ${file} 未登记校验值，sha256=${actual}`)
}

/** Windows 路径 → WSL 路径 */
function toWsl(p) {
  return execFileSync('wsl', ['-e', 'wslpath', '-a', p.replaceAll('\\', '/')], {
    encoding: 'utf8'
  }).trim()
}

mkdirSync(cacheDir, { recursive: true })
const arch = buildHostArch()
const wasiFile = `wasi-sdk-${WASI_SDK}-${arch}.tar.gz`
await fetchVerified(LIBREMPEG.file, LIBREMPEG.url, LIBREMPEG.sha256)
await fetchVerified(
  wasiFile,
  `https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-${WASI_SDK.split('.')[0]}/${wasiFile}`,
  WASI_SHA256[arch]
)

const script = join(nativeDir, 'build.sh')
if (process.platform === 'win32') {
  execFileSync('wsl', ['-e', 'bash', toWsl(script), toWsl(cacheDir), toWsl(wasmPath)], {
    stdio: 'inherit'
  })
} else {
  execFileSync('bash', [script, cacheDir, wasmPath], { stdio: 'inherit' })
}

if (!existsSync(wasmPath)) throw new Error(`编译成功但找不到产物：${wasmPath}`)
const wasm = readFileSync(wasmPath)
const b64 = wasm.toString('base64')
// 数组 + join 而不是 build-wasm.mjs 那种 `'…' +` 串接：几千段 `+` 是一棵几千层深的表达式树，
// Node 的 TS 类型剥离会栈溢出；平铺的数组没有这个问题
const lines = (b64.match(/.{1,96}/g) ?? []).map((l) => `  '${l}'`).join(',\n')

writeFileSync(
  outPath,
  `/**
 * 自动生成，请勿手改。
 *
 * 源：native/dolby-wasm（shim.c + LibreMPEG ${LIBREMPEG_COMMIT.slice(0, 10)}，GPL-3.0-or-later）
 * 重新生成：npm run build:dolby-wasm
 */

/** dolby.wasm 的 base64（${wasm.length} 字节） */
export const DOLBY_WASM_BASE64 = [
${lines}
].join('')
`,
  'utf8'
)

console.log(`[build-dolby-wasm] ${wasm.length} B wasm → ${outPath}`)
