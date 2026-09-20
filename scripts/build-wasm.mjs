/**
 * 编译 native/qmc-wasm 并把产物内联成 TS 模块（base64）。
 *
 * 为什么内联而不是当资源文件发：.wasm 只有 ~2.6KB，内联成 base64 后由 electron-vite
 * 正常打进 out/main/index.js，彻底绕开 asar 路径 / electron-builder files 规则 /
 * 开发与打包两套 __dirname 的一堆坑，运行时也不用碰磁盘。
 *
 * 产物 src/main/crypto/qmcWasmBinary.ts **已提交进仓库**，所以 `npm run build`
 * 和 CI 三平台构建都不需要 Rust 工具链。只有改了 native/qmc-wasm/src/lib.rs
 * 才需要装 Rust 跑一次 `npm run build:wasm` 并把产物一起提交。
 *
 * 前置：rustup + `rustup target add wasm32-unknown-unknown`
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const crateDir = join(root, 'native', 'qmc-wasm')
const wasmPath = join(crateDir, 'target', 'wasm32-unknown-unknown', 'release', 'qmc_wasm.wasm')
const outPath = join(root, 'src', 'main', 'crypto', 'qmcWasmBinary.ts')

/** rustup 默认不改 PATH，装完当前 shell 里常常没有 cargo —— 兜底找一下默认安装位置 */
function resolveCargo() {
  const home = process.env.USERPROFILE || process.env.HOME || ''
  const candidates = [
    'cargo',
    join(home, '.cargo', 'bin', process.platform === 'win32' ? 'cargo.exe' : 'cargo')
  ]
  for (const c of candidates) {
    try {
      execFileSync(c, ['--version'], { stdio: 'ignore' })
      return c
    } catch {
      /* 试下一个 */
    }
  }
  throw new Error(
    '找不到 cargo。请先安装 Rust（https://rustup.rs）并执行：\n' +
      '  rustup target add wasm32-unknown-unknown'
  )
}

const cargo = resolveCargo()
console.log(`[build-wasm] cargo: ${cargo}`)
execFileSync(cargo, ['build', '--release', '--target', 'wasm32-unknown-unknown'], {
  cwd: crateDir,
  stdio: 'inherit'
})

if (!existsSync(wasmPath)) throw new Error(`编译成功但找不到产物：${wasmPath}`)
const wasm = readFileSync(wasmPath)
const b64 = wasm.toString('base64')

// 每行 96 字符，避免生成一行几 KB 的巨长字符串（prettier/diff 都难看）
const lines = (b64.match(/.{1,96}/g) ?? []).map((l) => `  '${l}'`).join(' +\n')

writeFileSync(
  outPath,
  `/**
 * 自动生成，请勿手改。
 *
 * 源：native/qmc-wasm/src/lib.rs
 * 重新生成：npm run build:wasm
 */

/** qmc_wasm.wasm 的 base64（${wasm.length} 字节） */
export const QMC_WASM_BASE64 =
${lines}
`,
  'utf8'
)

console.log(`[build-wasm] ${wasm.length} B wasm → ${outPath}`)
