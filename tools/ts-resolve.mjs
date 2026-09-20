/**
 * 让 `node --test` 能直接 import 仓库里的 .ts 源码。
 *
 * Node 自带的类型剥离（type stripping）只管去掉类型标注，不做 TS 那套路径解析 ——
 * 而本仓库的 import 全是无扩展名的（平时由 electron-vite 解析）。这里补一个最小的
 * resolve 钩子：相对路径且没有扩展名时，试 `.ts` 和 `/index.ts`。
 *
 * 用法见 package.json 的 test 脚本：`node --import ./tools/ts-resolve.mjs --test ...`
 * 只覆盖相对路径，不处理 @common/@renderer 别名 —— 需要别名的模块本来也不该进纯 Node 测试。
 */
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !/\.[a-z0-9]+$/i.test(specifier) && context.parentURL) {
      const base = new URL(specifier, context.parentURL)
      for (const ext of ['.ts', '/index.ts']) {
        const candidate = new URL(base.href + ext)
        if (existsSync(fileURLToPath(candidate))) return { url: candidate.href, shortCircuit: true }
      }
    }
    return nextResolve(specifier, context)
  }
})
