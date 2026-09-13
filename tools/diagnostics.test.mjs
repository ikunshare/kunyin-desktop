import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, readdirSync, statSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import ts from 'typescript'
const require = createRequire(import.meta.url)
const root = new URL('../', import.meta.url)
function load(path, mocks = {}) {
  const source = readFileSync(new URL(path, root), 'utf8')
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
  const module = { exports: {} }
  new Function('require', 'module', 'exports', 'console', 'process', js)(
    (name) => {
      if (name in mocks) return mocks[name]
      return require(name)
    },
    module,
    module.exports,
    mocks.console ?? console,
    mocks.process ?? process
  )
  return module.exports
}
const sanitize = load('src/common/logSanitize.ts')
test('redacts Error, credentials, embedded URLs, queries, bearer and accessors', () => {
  const secret = 'NEVER_EXPOSE_123456789'
  const data = {
    password: secret,
    authorization: `Bearer ${secret}`,
    nested: new Error(`failed https://user:${secret}@host/${secret}?custom=${secret}#${secret}`),
    text: `token=${secret} /relative?custom=${secret}`,
    get bad() {
      throw Error(secret)
    }
  }
  const out = JSON.stringify(sanitize.redact(data))
  assert.ok(!out.includes(secret), out)
  assert.ok(out.includes('host'))
  assert.ok(
    !JSON.stringify(
      sanitize.redact(
        new Proxy(
          {},
          {
            ownKeys() {
              throw Error(secret)
            }
          }
        )
      )
    ).includes(secret)
  )
  const circular = {}
  circular.self = circular
  assert.ok(JSON.stringify(sanitize.redact(circular)).length < 500)
  assert.ok(sanitize.sanitizeText('x'.repeat(100000)).length <= 2000)
})
const identity = load('src/renderer/src/utils/songIdentity.ts', {
  '@common': { PLATFORM_NAMES: { kg: '酷狗', qq: 'QQ' } }
})
test('all stored identities survive including equal fields; no invented RID', () => {
  for (const type of ['qq', 'kg', 'kw', 'wy', 'joox', 'local']) {
    const item = {
      type,
      id: '123',
      mid: '123',
      mediaMid: '123',
      hash: 'hash',
      audioId: '123',
      mixsongmid: '123',
      album_audio_id: '123',
      album: '专辑',
      albumname: '专辑',
      albumid: '123',
      albumId: '123',
      albummid: '123',
      albumMid: '123',
      allHash: ['hash'],
      absent: '',
      empty: null,
      zero: 0,
      qualities: { flac: { mediaInfo: '123' } }
    }
    const fields = identity.buildSongInfoGroups(item).flatMap((g) => g.fields)
    for (const key of [
      'id',
      'mid',
      'mediaMid',
      'hash',
      'audioId',
      'mixsongmid',
      'album_audio_id',
      'albumname',
      'albumid',
      'albummid',
      'albumMid',
      'allHash.0',
      'qualities.flac.mediaInfo'
    ])
      assert.ok(
        fields.some((f) => f.key === key),
        `${type}:${key}`
      )
    assert.ok(!fields.some((f) => ['absent', 'empty', 'musicrid'].includes(f.key)))
    assert.deepEqual(JSON.parse(identity.buildSongInfoJson(item)), item)
  }
})
const { isDevToolsCombo } = load('src/common/devtoolsShortcut.ts')
test('release shortcut matches exactly once per non-repeat keydown', () => {
  const input = { type: 'keyDown', key: 'F12', code: 'F12', control: true }
  assert.equal(isDevToolsCombo(input, false), true)
  for (const patch of [
    { isAutoRepeat: true },
    { type: 'keyUp' },
    { alt: true },
    { shift: true },
    { meta: true },
    { control: false }
  ])
    assert.equal(isDevToolsCombo({ ...input, ...patch }, false), false)
  assert.equal(isDevToolsCombo({ ...input, control: false, meta: true }, true), true)
  assert.ok(
    !readFileSync(new URL('src/main/index.ts', root), 'utf8').includes(
      'optimizer.watchWindowShortcuts'
    )
  )
})
test('main logger survives throwing sinks, rotates within limits, flushes before disabling and monitors crashes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kunyin-log-test-'))
  const events = new Map()
  const fakeProcess = Object.create(process)
  fakeProcess.on = (name, fn) => {
    events.set(name, fn)
  }
  const app = { on: (name, fn) => events.set(name, fn), getVersion: () => 'test', isPackaged: true }
  const logger = load('src/main/core/logger.ts', {
    electron: { app },
    './paths': { appDataPath: () => dir },
    '@common/logSanitize': sanitize,
    '@common': {
      DEFAULT_SETTINGS: { developer: { logLevel: 'info', logToFile: true } },
      LOG_LEVEL_WEIGHT: { debug: 0, info: 1, warn: 2, error: 3, silent: 4 }
    },
    console: {
      log() {
        throw Error('closed stdout')
      },
      warn() {},
      error() {}
    },
    process: fakeProcess
  })
  try {
    logger.initLogger('info', true)
    logger.log.info('must flush before disabling')
    logger.setLogToFile(false)
    assert.ok(
      readdirSync(dir).some((f) =>
        readFileSync(join(dir, f), 'utf8').includes('must flush before disabling')
      )
    )
    logger.setLogToFile(true)
    for (let i = 0; i < 40000; i++) logger.log.info('x'.repeat(2000))
    events.get('before-quit')()
    const sizes = readdirSync(dir).map((f) => statSync(join(dir, f)).size)
    assert.ok(sizes.every((s) => s <= 8 * 1024 * 1024))
    assert.ok(sizes.reduce((a, b) => a + b, 0) <= 64 * 1024 * 1024)
    assert.ok(events.has('uncaughtExceptionMonitor'))
    assert.ok(!events.has('uncaughtException'))
    assert.doesNotThrow(() => logger.writeRendererEntry({ level: '__proto__', message: 'bad' }))
    assert.ok(logger.getRecentLogs(100000).length <= 600)
  } finally {
    logger.setLogToFile(false)
    rmSync(dir, { recursive: true, force: true })
  }
})
