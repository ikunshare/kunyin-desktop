/**
 * 取流看门狗（src/main/audio/streamGuard.ts）的回归。
 *
 * 这些用例钉的是一条排查了很久的线上现象：**放久了之后任何歌曲都 upstream header
 * timeout，重启应用才恢复**。根因是上游半开（TCP 连着但不再发字节）时，
 * `reader.read()` 永久 pending，而读它的异步生成器此刻取消不掉 —— `AsyncGenerator.return()`
 * 排在未决的 `next()` 之后，`finally` 里的 `reader.cancel()` 永远跑不到，那条上游连接
 * 就永久留在 Chromium 连接池里（每主机 6 个额度、全进程 256 个）。
 *
 * 跑：npm test
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { guardStream, StreamStallError } from '../src/main/audio/streamGuard.ts'

/** 可手工投喂的源流；记录自己有没有被 cancel（= 上游连接有没有被归还） */
function controllable() {
  const state = { cancelled: false, cancelReason: undefined }
  let ctrl
  const stream = new ReadableStream({
    start(c) {
      ctrl = c
    },
    cancel(reason) {
      state.cancelled = true
      state.cancelReason = reason
    }
  })
  return {
    stream,
    state,
    push: (bytes) => ctrl.enqueue(new Uint8Array(bytes)),
    close: () => ctrl.close()
  }
}

async function readAll(stream) {
  const reader = stream.getReader()
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) return total
    total += value.byteLength
  }
}

test('正常读完：onData 累计字节，onSettle 恰好一次且为 end', async () => {
  const src = controllable()
  const settled = []
  const seen = []
  const guarded = guardStream(src.stream, {
    idleMs: 10_000,
    onData: (n) => seen.push(n),
    onSettle: (r) => settled.push(r)
  })
  src.push(4)
  src.push(6)
  src.close()
  assert.equal(await readAll(guarded), 10)
  assert.deepEqual(seen, [4, 6])
  assert.deepEqual(settled, ['end'])
})

test('上游停摆：未决的 read 在 idleMs 内落地，并把源流 cancel 掉（连接归还）', async () => {
  const src = controllable()
  const settled = []
  const guarded = guardStream(src.stream, {
    idleMs: 40,
    onSettle: (r) => settled.push(r)
  })
  const reader = guarded.getReader()
  const started = Date.now()
  await assert.rejects(() => reader.read(), StreamStallError)
  assert.ok(Date.now() - started < 1000, '必须由看门狗掐断，而不是无限等下去')
  assert.deepEqual(settled, ['stall'])
  assert.equal(src.state.cancelled, true, '源流必须被 cancel，否则 socket 永远不还')
})

test('下游取消：源流同步收到 cancel，onSettle 为 cancel', async () => {
  const src = controllable()
  const settled = []
  const guarded = guardStream(src.stream, { idleMs: 10_000, onSettle: (r) => settled.push(r) })
  await guarded.cancel('切歌')
  assert.deepEqual(settled, ['cancel'])
  assert.equal(src.state.cancelled, true)
  assert.equal(src.state.cancelReason, '切歌')
})

test('停摆判定只在「下游正在要数据」时计时：暂停/缓冲满不会误伤', async () => {
  const src = controllable()
  const settled = []
  const guarded = guardStream(src.stream, { idleMs: 30, onSettle: (r) => settled.push(r) })
  const reader = guarded.getReader()
  src.push(8)
  assert.equal((await reader.read()).value.byteLength, 8)
  // 拿到一块之后就不再 read（<audio> 缓冲满时正是这样）：此刻没人在等数据，
  // 上游「不发」是我们自己的背压造成的，不能算停摆。
  await new Promise((r) => setTimeout(r, 120))
  assert.deepEqual(settled, [], '没人要数据时不该判停摆')
  src.push(2)
  assert.equal((await reader.read()).value.byteLength, 2)
  assert.deepEqual(settled, [])
})

test('停摆会让读它的异步生成器解开，finally 跑得到（否则上游连接永久泄漏）', async () => {
  const src = controllable()
  const guarded = guardStream(src.stream, { idleMs: 40 })
  let finallyRan = false

  // 复刻 protocol.ts 里 fetchAndStore 的形状：生成器持有 reader，靠 finally 归还上游
  async function* consume() {
    const reader = guarded.getReader()
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) return
        yield value
      }
    } finally {
      finallyRan = true
      await reader.cancel().catch(() => {})
    }
  }

  const gen = consume()
  src.push(3)
  assert.equal((await gen.next()).value.byteLength, 3)
  // 这一次 next 会卡在 await reader.read()；没有看门狗的话它永远不落地，
  // 而此时 gen.return() 也救不了（见下一条用例）。
  await assert.rejects(() => gen.next(), StreamStallError)
  assert.equal(finallyRan, true)
  assert.equal(src.state.cancelled, true)
})

test('钉死设计前提：AsyncGenerator.return() 解不开卡在 await 里的生成器', async () => {
  let finallyRan = false
  const never = new Promise(() => {})
  async function* stuck() {
    try {
      yield 1
      await never
      yield 2
    } finally {
      finallyRan = true
    }
  }
  const gen = stuck()
  assert.equal((await gen.next()).value, 1)
  void gen.next().catch(() => {}) // 卡进 await never
  const outcome = await Promise.race([
    gen.return(undefined).then(() => 'returned'),
    new Promise((r) => setTimeout(() => r('still-stuck'), 150))
  ])
  // 所以取消上游流**不能**只靠 gen.return()：必须先 abort/cancel 让那个 await 落地。
  assert.equal(outcome, 'still-stuck')
  assert.equal(finallyRan, false)
})
