/**
 * 生成「设置 → 关于坤音」的开源许可列表 src/renderer/src/views/settings/ossLicenses.ts（自动生成，别手改）。
 *
 * 只列真正进了安装包的代码，外加内嵌 / 移植的上游项目。来源有三个：
 * - 主进程：package.json `dependencies` 的整棵生产依赖树，electron-builder 原样打进 app.asar。
 *   只顺着 dependencies / optionalDependencies 走、**不走 peer**：@electron-toolkit/utils 把 electron
 *   声明成 peer，lockfile 因此把 electron 的下载器（@electron/get、undici…）也标成了非 dev，但它们不进包。
 * - 渲染层：Vite 打进 bundle 的模块。这里不能按依赖树算——vue 的 dependencies 带着 compiler-sfc 那一大串，
 *   一个都不进包。所以以产物为准：带 sourcemap 构建到临时目录，读 sources 里的 node_modules 路径；
 *   再补上渲染层直接 import 的包（vue 的入口只有 re-export，摇树后在 sourcemap 里不留痕迹）。
 *   Vite 注入的虚拟模块也不在 sources 里，见 VIRTUAL_HELPERS。
 * - 手工登记：Electron 及其内核（RUNTIME）、内嵌 / 移植的代码与编进 wasm 的库（EMBEDDED）。
 *
 * 每个许可证链接都在线核实：GitHub 仓库用 API 取 GitHub 认出的许可证文件（仓库根目录没有，再找包目录里的），
 * 其余地址直接 GET。**核实不了的不显示**——连在线许可证都没有是那个项目自己的事（用户定的规矩），
 * 名字记进 OSS_EXCLUDED，生成时也会打印出来。GitHub API 除 404 以外的失败（多半是限流）直接中止：
 * 不能把「没查成」当成「没有许可证」。
 *
 * 用法：npm run gen:licenses。要联网；有 GITHUB_TOKEN 或 gh 已登录时带令牌调 API
 * （匿名每小时只有 60 次，不够跑一轮）。装 / 删了依赖、渲染层新 import 了包之后重跑并提交产物，
 * 忘了的话 tools/ossLicenses.test.mjs 会报。
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outPath = join(root, 'src', 'renderer', 'src', 'views', 'settings', 'ossLicenses.ts')

/** Vite 注入进渲染层 bundle 的虚拟模块所属的包（sourcemap 的 sources 里没有它们） */
const VIRTUAL_HELPERS = [
  'vite', // vite/preload-helper：路由懒加载用的 __vitePreload
  '@vitejs/plugin-vue' // plugin-vue:export-helper：单文件组件的 _export_sfc
]

/** 项目显示名：一个仓库出多个包的，以及品牌名与包名不同的（其余直接用包名） */
const REPO_NAMES = {
  'vuejs/core': 'Vue',
  'vitejs/vite': 'Vite',
  'lodash/lodash': 'Lodash',
  'alex8088/electron-toolkit': 'Electron Toolkit',
  'electron-userland/electron-builder': 'electron-builder'
}

/** 杜比软解编进 wasm 的 LibreMPEG 提交，许可证链接钉在它上面（与「关于」页的源码地址一致） */
const LIBREMPEG_COMMIT = /^LIBREMPEG_COMMIT=(\w+)/m.exec(
  readFileSync(join(root, 'native', 'dolby-wasm', 'build.sh'), 'utf8')
)[1]

/**
 * 手工登记的项目。
 * - repo：GitHub 仓库，许可证经 API 查（licensePath 给了就查那个文件，ref 钉版本）；
 * - licenseUrl：不在 GitHub 上的，直接 GET 核实；
 * - license：SPDX。省略时取 GitHub 认出的，认不出（NOASSERTION）会报错要求手填。
 */
const RUNTIME = [
  {
    name: 'Electron',
    url: 'https://www.electronjs.org/',
    repo: 'electron/electron',
    usage: '应用运行时'
  },
  {
    name: 'Chromium',
    url: 'https://www.chromium.org/',
    licenseUrl: 'https://chromium.googlesource.com/chromium/src/+/main/LICENSE',
    license: 'BSD-3-Clause',
    usage: 'Electron 内核：界面渲染与音频播放',
    indirect: true
  },
  {
    name: 'V8',
    url: 'https://v8.dev/',
    licenseUrl: 'https://chromium.googlesource.com/v8/v8/+/main/LICENSE',
    license: 'BSD-3-Clause',
    usage: 'Electron 内置的 JavaScript 引擎',
    indirect: true
  },
  {
    name: 'Node.js',
    url: 'https://nodejs.org/',
    repo: 'nodejs/node',
    license: 'MIT',
    usage: 'Electron 内置，主进程运行时',
    indirect: true
  },
  {
    name: 'FFmpeg',
    url: 'https://ffmpeg.org/',
    repo: 'FFmpeg/FFmpeg',
    licensePath: 'LICENSE.md',
    // Chromium 按 LGPL 配置编它（不开 GPL 组件）
    license: 'LGPL-2.1-or-later',
    usage: 'Chromium 内置的音频解码',
    indirect: true
  }
]

const EMBEDDED = [
  {
    name: 'music-lyric-kit',
    repo: 'music-lyric/music-lyric-kit-node',
    usage: '歌词解析（内嵌源码）'
  },
  {
    name: 'music-lyric-player',
    repo: 'music-lyric/music-lyric-player-web',
    usage: '歌词渲染（内嵌源码）'
  },
  {
    name: 'Apple Music-like Lyrics',
    repo: 'amll-dev/applemusic-like-lyrics',
    usage: '播放页的流体渐变背景（内嵌 bg-render）'
  },
  {
    name: 'LX Music 桌面版',
    repo: 'lyswhut/lx-music-desktop',
    usage: '设置页布局、音效与混响脉冲响应、下载歌词、榜单与歌单接口等（移植）'
  },
  {
    name: 'phaze',
    repo: 'olvb/phaze',
    usage: '升降调的 phase vocoder（内嵌）'
  },
  {
    name: 'fft.js',
    repo: 'indutny/fft.js',
    usage: '升降调用到的 FFT（随 phaze 内嵌）'
  },
  {
    name: 'LibreMPEG',
    repo: 'librempeg/librempeg',
    licensePath: 'COPYING.GPLv3',
    ref: LIBREMPEG_COMMIT,
    license: 'GPL-3.0-or-later',
    usage: '杜比软解：AC-3 / E-AC-3 / AC-4 解码器（编译进 wasm）'
  },
  {
    name: 'wasi-libc',
    repo: 'WebAssembly/wasi-libc',
    license: 'Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT',
    usage: '杜比解码 wasm 静态链接的 C 库'
  },
  {
    name: 'Rust',
    url: 'https://www.rust-lang.org/',
    repo: 'rust-lang/rust',
    licensePath: 'LICENSE-MIT',
    license: 'MIT OR Apache-2.0',
    usage: 'QMC 解密 wasm 链接的 core 库'
  },
  {
    name: 'netease-report-listen-song',
    repo: 'folltoshe/netease-report-listen-song',
    usage: '网易云听歌上报：NCBL 封包（移植）'
  }
]

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'))

/** lockfile 路径（node_modules/a/node_modules/@s/b）→ 包名（@s/b） */
const nameOfPath = (p) => p.slice(p.lastIndexOf('node_modules/') + 'node_modules/'.length)

/**
 * 主进程进包的 npm 包：从 package.json dependencies 起顺着 lockfile 走（node 的就近解析）。
 * 返回 lockfile 路径 → 包名。同名不同版本各占一条路径。
 */
export function shippedMainPackages(dir = root) {
  const pkg = readJson(join(dir, 'package.json'))
  const lock = readJson(join(dir, 'package-lock.json')).packages
  const found = new Map()
  const visit = (from, name) => {
    for (let base = from; ;) {
      const p = `${base ? `${base}/` : ''}node_modules/${name}`
      if (lock[p]) {
        if (found.has(p)) return
        found.set(p, name)
        const e = lock[p]
        for (const d of Object.keys({ ...e.dependencies, ...e.optionalDependencies })) visit(p, d)
        return
      }
      if (!base) return // 没装上：多半是别的平台的可选依赖
      const i = base.lastIndexOf('/node_modules/')
      base = i < 0 ? '' : base.slice(0, i)
    }
  }
  for (const d of Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies })) visit('', d)
  return found
}

function listSources(dir) {
  const out = []
  for (const f of readdirSync(dir)) {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) out.push(...listSources(p))
    else if (/\.(ts|vue|js|mjs)$/.test(f) && !f.endsWith('.d.ts')) out.push(p)
  }
  return out
}

/** import 说明符 → 包名（'lodash-es/debounce' → 'lodash-es'，'@vue/shared/x' → '@vue/shared'） */
const packageOfSpecifier = (s) =>
  s
    .split('/')
    .slice(0, s.startsWith('@') ? 2 : 1)
    .join('/')

/**
 * 渲染层（含 src/common，它随渲染层一起打包）直接 import 的 npm 包。只认 package.json 里声明过的，
 * 别名（@common、music-lyric-kit…）和 `import type` 自然被滤掉。
 */
export function rendererImports(dir = root) {
  const pkg = readJson(join(dir, 'package.json'))
  const declared = new Set(Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }))
  const re =
    /\b(?:import|export)\s+(type\s+)?(?:[^'"`;]*?\s+from\s+)?['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/g
  const found = new Set()
  for (const file of [
    ...listSources(join(dir, 'src', 'renderer', 'src')),
    ...listSources(join(dir, 'src', 'common'))
  ]) {
    for (const m of readFileSync(file, 'utf8').matchAll(re)) {
      if (m[1]) continue
      const name = packageOfSpecifier(m[2] ?? m[3])
      if (declared.has(name)) found.add(name)
    }
  }
  return found
}

/** 带 sourcemap 构建到临时目录，返回打进渲染层 / 主进程 / preload bundle 的包（lockfile 路径形式） */
function bundledPackages() {
  const outDir = mkdtempSync(join(tmpdir(), 'kunyin-oss-'))
  try {
    const cli = join(root, 'node_modules', 'electron-vite', 'bin', 'electron-vite.js')
    execFileSync(
      process.execPath,
      [cli, 'build', '--sourcemap', '--outDir', outDir, '--logLevel', 'warn'],
      { cwd: root, stdio: 'inherit' }
    )
    const found = new Set()
    const walk = (dir) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f)
        if (statSync(p).isDirectory()) walk(p)
        else if (f.endsWith('.map')) {
          for (const s of readJson(p).sources) {
            const at = s.indexOf('node_modules/')
            if (at < 0) continue
            // node_modules/a/node_modules/@s/b/dist/x.js → node_modules/a/node_modules/@s/b
            const segs = s.slice(at).split('/')
            let end = 0
            for (let i = 0; i < segs.length; i++) {
              if (segs[i] !== 'node_modules') continue
              end = i + (segs[i + 1]?.startsWith('@') ? 3 : 2)
            }
            found.add(segs.slice(0, end).join('/'))
          }
        }
      }
    }
    walk(outDir)
    return found
  } finally {
    rmSync(outDir, { recursive: true, force: true })
  }
}

/** package.json 的 repository → GitHub 'owner/repo'（不是 GitHub 的返回 null） */
export function githubRepoOf(repository) {
  const raw = typeof repository === 'string' ? repository : repository?.url
  if (!raw) return null
  const short = /^(?:github:)?([\w.-]+)\/([\w.-]+)$/.exec(raw)
  if (short) return `${short[1]}/${short[2]}`
  const m = /github\.com[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[#/].*)?$/.exec(raw)
  return m ? `${m[1]}/${m[2]}` : null
}

function spdxOf(pkg) {
  const l = pkg.license ?? pkg.licenses
  const s =
    typeof l === 'string' ? l : Array.isArray(l) ? l.map((x) => x.type).join(' OR ') : l?.type
  // '(Apache-2.0 AND BSD-3-Clause)' → 'Apache-2.0 AND BSD-3-Clause'
  return s ? s.replace(/^\((.*)\)$/, '$1') : null
}

function githubToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN
  try {
    return execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', stdio: 'pipe' }).trim()
  } catch {
    console.warn(
      '[gen-licenses] 没有 GITHUB_TOKEN 也没有 gh 登录，匿名调 GitHub API（每小时 60 次）'
    )
    return ''
  }
}

let token = null
async function gh(path) {
  token ??= githubToken()
  const resp = await fetch(`https://api.github.com${path}`, {
    headers: {
      accept: 'application/vnd.github+json',
      'user-agent': 'kunyin-desktop gen-licenses',
      ...(token && { authorization: `Bearer ${token}` })
    }
  })
  if (resp.status === 404) return null
  if (!resp.ok) throw new Error(`GitHub API ${path}：HTTP ${resp.status} ${await resp.text()}`)
  return resp.json()
}

/** https://github.com/o/r/blob/<ref>/<path> → 'o/r'（仓库改过名时这里是新名字） */
const repoOfHtmlUrl = (u) => /^https:\/\/github\.com\/([^/]+\/[^/]+)\//.exec(u)[1]

/**
 * 在 GitHub 上找许可证文件：
 * - 给了 paths：逐个查这些文件（ref 省略即默认分支）；
 * - 没给：先要 GitHub 认出的那份（仓库根目录），没有再逐个试 fallbacks（包目录里的文件）。
 */
async function githubLicense(repo, { paths, ref, fallbacks = [] } = {}) {
  if (!paths) {
    const lic = await gh(`/repos/${repo}/license`)
    if (lic) {
      const spdx = lic.license?.spdx_id
      return {
        licenseUrl: lic.html_url,
        repo: repoOfHtmlUrl(lic.html_url),
        spdx: spdx && spdx !== 'NOASSERTION' ? spdx : null
      }
    }
  }
  for (const p of paths ?? fallbacks) {
    const q = ref ? `?ref=${ref}` : ''
    const c = await gh(
      `/repos/${repo}/contents/${p.split('/').map(encodeURIComponent).join('/')}${q}`
    )
    if (c && !Array.isArray(c) && c.type === 'file') {
      return { licenseUrl: c.html_url, repo: repoOfHtmlUrl(c.html_url), spdx: null }
    }
  }
  return null
}

async function urlExists(url) {
  const resp = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'kunyin-desktop' } })
  await resp.body?.cancel()
  return resp.ok
}

/** 手工登记的一项 → 列表项；核实不了返回 null */
async function resolveManual(entry) {
  const { repo, licensePath, ref, licenseUrl, ...rest } = entry
  let found
  if (licenseUrl) {
    found = (await urlExists(licenseUrl)) ? { licenseUrl, repo: null, spdx: null } : null
  } else {
    found = await githubLicense(repo, { paths: licensePath && [licensePath], ref })
  }
  if (!found) return null
  const license = entry.license ?? found.spdx
  if (!license)
    throw new Error(`${entry.name}：GitHub 认不出许可证类型，请在 MANUAL 里手填 license`)
  return {
    ...rest,
    url: entry.url ?? `https://github.com/${found.repo}`,
    license,
    licenseUrl: found.licenseUrl
  }
}

/** npm 包按仓库归并成项目 */
async function resolveNpm(paths, directNames) {
  const directRepos = new Set()
  for (const name of directNames) {
    const repo = githubRepoOf(readJson(join(root, 'node_modules', name, 'package.json')).repository)
    if (repo) directRepos.add(repo.toLowerCase())
  }

  const groups = new Map()
  const excluded = []
  for (const p of paths) {
    const dir = join(root, ...p.split('/'))
    const pkg = readJson(join(dir, 'package.json'))
    const repo = githubRepoOf(pkg.repository)
    if (!repo) {
      console.warn(
        `[gen-licenses] ${pkg.name}：repository 不在 GitHub 上（${JSON.stringify(pkg.repository)}），无法核实`
      )
      excluded.push(pkg.name)
      continue
    }
    const key = repo.toLowerCase()
    let g = groups.get(key)
    if (!g) groups.set(key, (g = { repo, names: new Set(), spdx: null, dirs: [] }))
    g.names.add(pkg.name)
    g.spdx ??= spdxOf(pkg)
    const localLicenses = readdirSync(dir).filter((f) => /^(licen[cs]e|copying)/i.test(f))
    const sub = typeof pkg.repository === 'object' ? pkg.repository.directory : null
    for (const f of localLicenses) g.dirs.push(sub ? `${sub}/${f}` : f)
  }

  const items = []
  for (const [key, g] of groups) {
    const names = [...g.names].sort()
    const found = await githubLicense(g.repo, { fallbacks: [...new Set(g.dirs)] })
    if (!found) {
      excluded.push(...names)
      continue
    }
    const name = REPO_NAMES[key] ?? (names.length === 1 ? names[0] : g.repo.split('/')[1])
    const license = g.spdx ?? found.spdx
    if (!license) throw new Error(`${name}：package.json 没写许可证、GitHub 也认不出`)
    items.push({
      name,
      url: `https://github.com/${found.repo}`,
      license,
      licenseUrl: found.licenseUrl,
      ...(names.length > 1 || names[0].toLowerCase() !== name.toLowerCase()
        ? { packages: names }
        : {}),
      ...(directRepos.has(key) || names.some((n) => directNames.has(n)) ? {} : { indirect: true })
    })
  }
  items.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }))
  return { items, excluded }
}

async function main() {
  const pkg = readJson(join(root, 'package.json'))
  const direct = new Set(Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }))

  const mainPkgs = shippedMainPackages()
  console.log(`[gen-licenses] 主进程依赖树：${mainPkgs.size} 个包`)
  const bundled = bundledPackages()
  const imported = rendererImports()
  console.log(
    `[gen-licenses] 打进 bundle：${bundled.size} 个包；渲染层直接 import：${imported.size} 个`
  )

  const paths = new Set([
    ...mainPkgs.keys(),
    ...bundled,
    ...[...imported, ...VIRTUAL_HELPERS].map((n) => `node_modules/${n}`)
  ])
  // 实际进包、且在 package.json 里声明过的才算「直接引用」（electron 这类只在构建期用的不算数）
  const directNames = new Set([...paths].map(nameOfPath).filter((n) => direct.has(n)))
  const npm = await resolveNpm(paths, directNames)

  const excluded = [...npm.excluded]
  const manual = async (entries) => {
    const out = []
    for (const e of entries) {
      const item = await resolveManual(e)
      if (item) out.push(item)
      else excluded.push(e.name)
    }
    return out
  }
  const sections = [
    { title: '运行环境', items: await manual(RUNTIME) },
    { title: '内嵌与移植的代码', items: await manual(EMBEDDED) },
    { title: 'npm 依赖', items: npm.items }
  ]
  excluded.sort()

  const source = `/**
 * 自动生成，请勿手改。
 *
 * 「设置 → 关于坤音」的开源许可列表：进了安装包的代码，外加内嵌 / 移植的上游项目。
 * 许可证链接生成时逐个在线核实过；核实不了的不显示，名字记在 OSS_EXCLUDED。
 * 重新生成：npm run gen:licenses（见 scripts/gen-licenses.mjs）
 */

export interface OssProject {
  name: string
  /** 项目主页 */
  url: string
  /** SPDX 许可证表达式 */
  license: string
  /** 在线许可证全文 */
  licenseUrl: string
  /** 坤音拿它做什么（手工登记的才有） */
  usage?: string
  /** 进包的 npm 包名（与 name 相同时省略） */
  packages?: string[]
  /** 经由别的依赖间接引用 */
  indirect?: boolean
}

export interface OssSection {
  title: string
  items: OssProject[]
}

export const OSS_SECTIONS: OssSection[] = ${JSON.stringify(sections, null, 2)}

/** 查不到在线许可证、因此不显示的项目 / npm 包 */
export const OSS_EXCLUDED: string[] = ${JSON.stringify(excluded)}
`
  const prettier = await import('prettier')
  const options = await prettier.resolveConfig(outPath)
  writeFileSync(outPath, await prettier.format(source, { ...options, filepath: outPath }), 'utf8')

  const total = sections.reduce((n, s) => n + s.items.length, 0)
  console.log(`[gen-licenses] ${total} 个项目 → ${outPath}`)
  if (excluded.length) console.log(`[gen-licenses] 没有在线许可证、不显示：${excluded.join('、')}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
