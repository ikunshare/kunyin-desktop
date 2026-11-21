/**
 * 编译 native/av3a-wasm（MOLAN-AV3A：AVS3-P3 / Audio Vivid 参考解码器）并把产物内联成 TS 模块（base64）。
 *
 * 跟 build-dolby-wasm.mjs 同一套做法：产物 src/main/audio/av3aWasmBinary.ts **已提交进仓库**，
 * `npm run build` 和 CI 都不需要这套工具链。只有升级 MOLAN-AV3A 或改了 shim.c 才要跑一次。
 *
 * 编译在类 Unix 环境里跑（Linux / macOS 直接用 bash，Windows 走 WSL），源码包与 wasi-sdk 在宿主机这边
 * 下载并校验 sha256——WSL 里常常解析不了外网域名。wasi-sdk 与杜比那边是同一个版本，
 * native/dolby-wasm/.cache 里已经有了就直接用，不再下一遍（近 200MB）。
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const nativeDir = join(root, 'native', 'av3a-wasm')
const cacheDir = join(nativeDir, '.cache')
const dolbyCacheDir = join(root, 'native', 'dolby-wasm', '.cache')
const wasmPath = join(cacheDir, 'av3a.wasm')
const outPath = join(root, 'src', 'main', 'audio', 'av3aWasmBinary.ts')

// 版本与 build.sh 顶部的 MOLAN_COMMIT / WASI_SDK 保持一致
const MOLAN_COMMIT = '1564bd332205bb46afee8c643776f833020b94b6'
const MOLAN = {
  file: `MOLAN-AV3A-${MOLAN_COMMIT}.tar.gz`,
  url: `https://github.com/baiji6/MOLAN-AV3A/archive/${MOLAN_COMMIT}.tar.gz`,
  sha256: '9b7fb4d8204cd650c364932d19f72e4a15fd0c2e466653d13c5bfa92d3b0a77e'
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

/** 下载（已有则跳过）并校验，返回本地路径；candidates 里先找到的直接用 */
async function fetchVerified(file, url, expected, candidates = []) {
  const dest = candidates.map((dir) => join(dir, file)).find(existsSync) ?? join(cacheDir, file)
  if (!existsSync(dest)) {
    console.log(`[build-av3a-wasm] 下载 ${url}`)
    const resp = await fetch(url)
    if (!resp.ok) throw new Error(`下载失败 ${resp.status}：${url}`)
    writeFileSync(dest, Buffer.from(await resp.arrayBuffer()))
  }
  const actual = sha256(dest)
  if (expected && actual !== expected) {
    throw new Error(`${file} 的 sha256 不符：\n  期望 ${expected}\n  实际 ${actual}\n删掉它重下`)
  }
  if (!expected) console.warn(`[build-av3a-wasm] ${file} 未登记校验值，sha256=${actual}`)
  return dest
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
const molanTar = await fetchVerified(MOLAN.file, MOLAN.url, MOLAN.sha256)
const wasiTar = await fetchVerified(
  wasiFile,
  `https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-${WASI_SDK.split('.')[0]}/${wasiFile}`,
  WASI_SHA256[arch],
  [dolbyCacheDir]
)

const script = join(nativeDir, 'build.sh')
const args = [script, molanTar, wasiTar, wasmPath]
if (process.platform === 'win32') {
  execFileSync('wsl', ['-e', 'bash', ...args.map(toWsl)], { stdio: 'inherit' })
} else {
  execFileSync('bash', args, { stdio: 'inherit' })
}

if (!existsSync(wasmPath)) throw new Error(`编译成功但找不到产物：${wasmPath}`)
const wasm = readFileSync(wasmPath)
const b64 = wasm.toString('base64')
// 数组 + join：几千段 `'…' +` 串接会让 Node 的 TS 类型剥离栈溢出（见 build-dolby-wasm.mjs）
const lines = (b64.match(/.{1,96}/g) ?? []).map((l) => `  '${l}'`).join(',\n')

writeFileSync(
  outPath,
  `/**
 * 自动生成，请勿手改。
 *
 * 源：native/av3a-wasm（shim.c + MOLAN-AV3A ${MOLAN_COMMIT.slice(0, 10)}，
 * AVS3-P3 参考解码器 AVS3A_RMv3.3.1，UWA Code Sharing Policy）
 * 重新生成：npm run build:av3a-wasm
 */

/** av3a.wasm 的 base64（${wasm.length} 字节） */
export const AV3A_WASM_BASE64 = [
${lines}
].join('')
`,
  'utf8'
)

console.log(`[build-av3a-wasm] ${wasm.length} B wasm → ${outPath}`)
