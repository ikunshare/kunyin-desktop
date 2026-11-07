import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const COMMIT = '85c67622adb339142a1dc22841a09e0b81373694'
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const nativeDir = join(root, 'native', 'temari-wasm')
const sourceDir = join(nativeDir, '.cache', 'Temari')
const wasmPath = process.env.TEMARI_WASM_PATH
  ? resolve(process.env.TEMARI_WASM_PATH)
  : join(sourceDir, 'target', 'wasm32-unknown-unknown', 'release', 'temari.wasm')
const outPath = join(root, 'src', 'main', 'audio', 'temariWasmBinary.ts')

mkdirSync(nativeDir, { recursive: true })
if (!process.env.TEMARI_WASM_PATH) {
  if (!existsSync(sourceDir)) {
    mkdirSync(dirname(sourceDir), { recursive: true })
    execFileSync(
      'git',
      ['clone', '--depth=1', 'https://github.com/WorldObservationLog/Temari.git', sourceDir],
      { stdio: 'inherit' }
    )
  }
  const head = execFileSync('git', ['-C', sourceDir, 'rev-parse', 'HEAD'], {
    encoding: 'utf8'
  }).trim()
  if (head !== COMMIT) {
    execFileSync('git', ['-C', sourceDir, 'fetch', '--depth=1', 'origin', COMMIT], {
      stdio: 'inherit'
    })
    execFileSync('git', ['-C', sourceDir, 'checkout', COMMIT], { stdio: 'inherit' })
  }
  execFileSync('rustup', ['target', 'add', 'wasm32-unknown-unknown'], { stdio: 'inherit' })
  execFileSync('cargo', ['build', '--release', '--target', 'wasm32-unknown-unknown'], {
    cwd: sourceDir,
    stdio: 'inherit'
  })
}
if (!existsSync(wasmPath)) throw new Error(`找不到 Temari WASM：${wasmPath}`)

const wasm = readFileSync(wasmPath)
const lines = (wasm.toString('base64').match(/.{1,96}/g) ?? [])
  .map((line) => `  '${line}'`)
  .join(',\n')
writeFileSync(
  outPath,
  `/**\n * 自动生成，请勿手改。源：WorldObservationLog/Temari ${COMMIT.slice(0, 12)}（MIT）。\n * 重新生成：npm run build:temari-wasm\n */\n\nexport const TEMARI_WASM_BASE64 = [\n${lines}\n].join('')\n`,
  'utf8'
)
copyFileSync(join(sourceDir, 'LICENSE'), join(nativeDir, 'LICENSE'))
console.log(`[build-temari-wasm] ${wasm.length} B wasm → ${outPath}`)
