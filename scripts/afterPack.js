'use strict'
const fs = require('fs')
const path = require('path')

/** electron-builder 的平台名 → better-sqlite3 prebuilds 的文件名前缀 */
const PREBUILD_PREFIX = { win32: 'win32', darwin: 'darwin', linux: 'linux' }

/**
 * 剔除非目标平台的 better-sqlite3 预编译二进制（每个平台只留自己的，约省 8M）。
 *
 * 这件事本该由 files 规则做，但平台级 files 一旦存在，顶层 files 里那份应用主体的
 * 排除规则就会被 electron-builder 静默忽略（1.0.5 因此把 .git 打进了包），
 * 所以 win/mac/linux 段不再设 files，改在这里按实际目标平台清理。
 *
 * .node 会被 electron-builder 自动 unpack 到 app.asar.unpacked，是真实文件，可直接删。
 * 同平台的 arm64 一并保留——换架构构建时才不会重现「找不到原生模块」（issue #1）。
 */
function pruneForeignPrebuilds(context) {
  const keep = PREBUILD_PREFIX[context.electronPlatformName]
  if (!keep) return
  const dir = path.join(
    context.appOutDir,
    context.electronPlatformName === 'darwin'
      ? path.join(`${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
      : 'resources',
    'app.asar.unpacked',
    'node_modules',
    'better-sqlite3',
    'prebuilds'
  )
  if (!fs.existsSync(dir)) return
  for (const name of fs.readdirSync(dir)) {
    // 只按前缀判断，避免把 linux 误判成 linuxmusl（后者已由 files 规则排除）
    if (name.startsWith(`${keep}-`)) continue
    fs.rmSync(path.join(dir, name), { recursive: true, force: true })
    console.log(`[afterPack] 已删除非目标平台的原生模块: ${name}`)
  }
}

/**
 * 删除用不上的 DirectX Shader Compiler（Windows，约 26M）。
 *
 * dxcompiler.dll / dxil.dll 是 Chromium 给 WebGPU（Dawn）编译 HLSL 用的，按需加载。
 * 本应用的图形栈只有 WebGL（bg-render 走 canvas.getContext('webgl')），从不初始化
 * WebGPU，所以这两个文件在整个生命周期里不会被碰到。
 *
 * ⚠ 将来若真要用 WebGPU（navigator.gpu），必须先把这里去掉。
 * 软件渲染回退 vk_swiftshader.dll 则**保留**：虚拟机、远程桌面、老显卡上没它 WebGL 直接黑屏。
 */
function pruneUnusedGpuLibs(context) {
  if (context.electronPlatformName !== 'win32') return
  for (const name of ['dxcompiler.dll', 'dxil.dll']) {
    const file = path.join(context.appOutDir, name)
    if (!fs.existsSync(file)) continue
    fs.rmSync(file, { force: true })
    console.log(`[afterPack] 已删除未使用的 WebGPU 着色器编译器: ${name}`)
  }
}

/**
 * 打包后清理：
 * - 删除 Electron 自带的 LICENSES.chromium.html(~15M 许可文本)
 * - 剔除非目标平台的原生模块
 * - 删除只有 WebGPU 才用的着色器编译器
 */
exports.default = async function (context) {
  const licenseFile = path.join(context.appOutDir, 'LICENSES.chromium.html')
  if (fs.existsSync(licenseFile)) {
    fs.unlinkSync(licenseFile)
    console.log('[afterPack] 已删除 LICENSES.chromium.html')
  }
  pruneForeignPrebuilds(context)
  pruneUnusedGpuLibs(context)
}
