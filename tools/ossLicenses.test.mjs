/**
 * 「关于」页的开源许可列表有没有跟上依赖。
 *
 * 列表（src/renderer/src/views/settings/ossLicenses.ts）由 scripts/gen-licenses.mjs 生成，
 * 生成要构建一次、还要联网核实每个许可证链接，所以这里只做离线的覆盖检查：
 * 进了 app.asar 的主进程依赖、渲染层直接 import 的包，要么在列表里，要么已知没有在线许可证。
 * 挂了就是装 / 删了依赖之后忘了跑 `npm run gen:licenses`。
 *
 * 跑：npm test
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { OSS_EXCLUDED, OSS_SECTIONS } from '../src/renderer/src/views/settings/ossLicenses.ts'
import { rendererImports, shippedMainPackages } from '../scripts/gen-licenses.mjs'

const items = OSS_SECTIONS.flatMap((s) => s.items)
const known = new Set([...items.flatMap((i) => i.packages ?? [i.name]), ...OSS_EXCLUDED])
const hint = '依赖变了，重跑 npm run gen:licenses 并提交 ossLicenses.ts'

test('主进程进包的依赖都登记了', () => {
  const missing = [...new Set(shippedMainPackages().values())].filter((n) => !known.has(n))
  assert.deepEqual(missing, [], hint)
})

test('渲染层直接 import 的包都登记了', () => {
  const missing = [...rendererImports()].filter((n) => !known.has(n))
  assert.deepEqual(missing, [], hint)
})

test('electron 的下载器依赖不算进包', () => {
  // @electron-toolkit/utils 把 electron 声明成 peer，lockfile 因此把 electron 及其下载器标成非 dev；
  // 顺着 peer 走会把 @electron/get、undici 这些根本不进 app.asar 的包列进来
  const names = new Set(shippedMainPackages().values())
  assert.equal(names.has('electron'), false)
  assert.equal(names.has('@electron/get'), false)
})

test('每一项都有许可证与在线链接', () => {
  for (const i of items) {
    assert.ok(i.license, `${i.name} 缺许可证`)
    assert.match(i.licenseUrl, /^https:\/\//, `${i.name} 的许可证链接`)
    assert.match(i.url, /^https:\/\//, `${i.name} 的主页`)
  }
  const names = items.map((i) => i.name)
  assert.equal(new Set(names).size, names.length, '项目名重复')
})
