/**
 * 网络策略层（src/main/net/policy.ts）的回归。
 *
 * 这些是网络栈里唯一能脱离 Electron 跑的部分，也正是最容易写错的部分：
 * 并发闸的许可转交、重试退避的抖动边界、Retry-After 的两种格式。
 *
 * 跑：npm test
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  CHROMIUM_PER_HOST_SOCKETS,
  DEFAULT_HOST_CONCURRENCY,
  DEFAULT_RETRY,
  HostGate,
  InflightMap,
  backoffDelay,
  coalesceKeyOf,
  hostKeyOf,
  isIdempotent,
  isRetriableStatus,
  parseRetryAfter
} from '../src/main/net/policy.ts'

/** 手动控制的 deferred，用来把「请求在飞」这个状态钉住 */
function deferred() {
  let resolve, reject
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

test('接口并发闸必须严格低于 Chromium per-host 额度（否则挤掉取流）', () => {
  assert.ok(DEFAULT_HOST_CONCURRENCY < CHROMIUM_PER_HOST_SOCKETS)
})

test('hostKeyOf：按 scheme+host+port 分组，与 Chromium 连接池一致', () => {
  assert.equal(hostKeyOf('https://y.qq.com/a?b=1'), 'https://y.qq.com')
  assert.equal(hostKeyOf('https://y.qq.com/other'), 'https://y.qq.com')
  // 端口不同即不同池
  assert.notEqual(hostKeyOf('https://y.qq.com:8443/x'), hostKeyOf('https://y.qq.com/x'))
  // http/https 不同池
  assert.notEqual(hostKeyOf('http://y.qq.com/x'), hostKeyOf('https://y.qq.com/x'))
  // 解析不了就退化成整条 URL，各自排队
  assert.equal(hostKeyOf('not a url'), 'not a url')
})

test('HostGate：同 host 在飞数不超上限，超出的排队', async () => {
  const gate = new HostGate(2)
  const gates = [deferred(), deferred(), deferred(), deferred()]
  let started = 0
  const runs = gates.map((d) =>
    gate.run('https://a.example/x', () => {
      started++
      return d.promise
    })
  )

  // 微任务跑完后应只放行 2 个
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(started, 2, '并发闸没挡住第 3 个请求')

  gates[0].resolve('r0')
  await runs[0]
  assert.equal(started, 3, '释放后没唤醒队首')

  gates[1].resolve('r1')
  gates[2].resolve('r2')
  gates[3].resolve('r3')
  assert.deepEqual(await Promise.all(runs), ['r0', 'r1', 'r2', 'r3'])
})

test('HostGate：不同 host 互不排队', async () => {
  const gate = new HostGate(1)
  const a = deferred()
  let bRan = false
  const ra = gate.run('https://a.example/x', () => a.promise)
  const rb = gate.run('https://b.example/x', () => {
    bRan = true
    return Promise.resolve('b')
  })
  assert.equal(await rb, 'b')
  assert.ok(bRan, 'b host 被 a host 挡住了')
  a.resolve('a')
  assert.equal(await ra, 'a')
})

test('HostGate：任务抛错也释放许可，不会把 host 永久锁死', async () => {
  const gate = new HostGate(1)
  await assert.rejects(
    gate.run('https://a.example/x', () => Promise.reject(new Error('boom'))),
    /boom/
  )
  assert.equal(await gate.run('https://a.example/x', () => Promise.resolve('ok')), 'ok')
})

test('HostGate：释放与新调用交错时，在飞数仍不超上限', async () => {
  // 不变量检查（不是某个已知 bug 的回归）：在「持有者释放」与「新调用进入」交错的
  // 时序下，同时在跑的任务数始终 <= limit。
  const gate = new HostGate(1)
  let concurrent = 0
  let peak = 0
  const hold = deferred()

  const body = async (d) => {
    concurrent++
    peak = Math.max(peak, concurrent)
    try {
      return await d.promise
    } finally {
      concurrent--
    }
  }

  const d1 = deferred()
  const d2 = deferred()
  const r1 = gate.run('https://a.example/x', () => body(hold))
  const r2 = gate.run('https://a.example/x', () => body(d1))
  await Promise.resolve()
  hold.resolve('1')
  // 在「上一个已完成、等待者还没接手」的这一拍插入新调用
  const r3 = gate.run('https://a.example/x', () => body(d2))
  await r1
  d1.resolve('2')
  await r2
  d2.resolve('3')
  await r3
  assert.equal(peak, 1, `在飞数冲破了上限：peak=${peak}`)
})

test('HostGate：队列排空后不再留下 host 条目（长跑进程不泄漏）', async () => {
  const gate = new HostGate(2)
  await Promise.all([
    gate.run('https://a.example/x', () => Promise.resolve(1)),
    gate.run('https://a.example/y', () => Promise.resolve(2)),
    gate.run('https://b.example/z', () => Promise.resolve(3))
  ])
  assert.deepEqual(gate.stats(), [])
})

test('isIdempotent：只有 GET/HEAD/OPTIONS 能重放', () => {
  assert.ok(isIdempotent('GET'))
  assert.ok(isIdempotent('get'))
  assert.ok(isIdempotent('HEAD'))
  assert.ok(isIdempotent('OPTIONS'))
  // POST 重放会造成重复上报（qq/report.ts）
  assert.ok(!isIdempotent('POST'))
  assert.ok(!isIdempotent('PUT'))
  assert.ok(!isIdempotent('DELETE'))
})

test('isRetriableStatus：429 与 5xx 重试，4xx 与「不支持」不重试', () => {
  assert.ok(isRetriableStatus(429))
  assert.ok(isRetriableStatus(500))
  assert.ok(isRetriableStatus(502))
  assert.ok(isRetriableStatus(503))
  assert.ok(!isRetriableStatus(200))
  assert.ok(!isRetriableStatus(400))
  assert.ok(!isRetriableStatus(403))
  assert.ok(!isRetriableStatus(404))
  // 服务端明确不支持，重试没意义
  assert.ok(!isRetriableStatus(501))
  assert.ok(!isRetriableStatus(505))
})

test('backoffDelay：指数增长、受 maxDelayMs 封顶、满抖动在 [0, exp]', () => {
  const policy = { attempts: 5, baseDelayMs: 100, maxDelayMs: 800 }
  // rng=1 取上界，看指数与封顶
  assert.equal(
    backoffDelay(1, policy, () => 1),
    100
  )
  assert.equal(
    backoffDelay(2, policy, () => 1),
    200
  )
  assert.equal(
    backoffDelay(3, policy, () => 1),
    400
  )
  assert.equal(
    backoffDelay(4, policy, () => 1),
    800
  )
  assert.equal(
    backoffDelay(5, policy, () => 1),
    800,
    '没有被 maxDelayMs 封顶'
  )
  // rng=0 取下界：满抖动允许 0（立即重试）
  assert.equal(
    backoffDelay(3, policy, () => 0),
    0
  )
  // 抖动始终落在 [0, exp]
  for (let attempt = 1; attempt <= 5; attempt++) {
    const exp = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** (attempt - 1))
    for (let i = 0; i < 50; i++) {
      const d = backoffDelay(attempt, policy)
      assert.ok(d >= 0 && d <= exp, `attempt=${attempt} delay=${d} 超出 [0,${exp}]`)
    }
  }
  // attempt=0 不该产生负指数
  assert.equal(
    backoffDelay(0, policy, () => 1),
    100
  )
})

test('backoffDelay：默认策略下总退避是有界的', () => {
  let total = 0
  for (let a = 1; a < DEFAULT_RETRY.attempts; a++) {
    total += backoffDelay(a, DEFAULT_RETRY, () => 1)
  }
  assert.ok(total <= 5000, `默认重试最坏情况等太久：${total}ms`)
})

test('parseRetryAfter：秒数、HTTP 日期、无效值、30s 封顶', () => {
  const now = Date.parse('2026-01-01T00:00:00Z')
  assert.equal(parseRetryAfter('5', now), 5000)
  assert.equal(parseRetryAfter('  5  ', now), 5000)
  assert.equal(parseRetryAfter('0', now), 0)
  // HTTP 日期形式
  assert.equal(parseRetryAfter('Thu, 01 Jan 2026 00:00:10 GMT', now), 10_000)
  // 过去的时间点 → 0，不是负数
  assert.equal(parseRetryAfter('Thu, 01 Jan 2026 00:00:00 GMT', now + 5000), 0)
  // 荒谬的长等待被封顶，不能把请求永久挂死
  assert.equal(parseRetryAfter('99999', now), 30_000)
  assert.equal(parseRetryAfter('Fri, 02 Jan 2026 00:00:00 GMT', now), 30_000)
  // 无值 / 无法解析
  assert.equal(parseRetryAfter(null, now), null)
  assert.equal(parseRetryAfter(undefined, now), null)
  assert.equal(parseRetryAfter('', now), null)
  assert.equal(parseRetryAfter('   ', now), null)
  assert.equal(parseRetryAfter('soon', now), null)
})

test('InflightMap：同 key 并发只跑一次，返回后不再共享', async () => {
  const map = new InflightMap()
  let calls = 0
  const d = deferred()
  const task = () => {
    calls++
    return d.promise
  }
  const a = map.run('k', task)
  const b = map.run('k', task)
  // task 被包在微任务里，等一拍再看调用数
  await Promise.resolve()
  assert.equal(calls, 1, '并发没被合并')
  assert.equal(map.size(), 1)
  d.resolve('v')
  assert.equal(await a, 'v')
  assert.equal(await b, 'v')
  assert.equal(map.size(), 0, '返回后没清理，退化成了无 TTL 缓存')

  // 返回后再调应是一次新的真实请求
  assert.equal(await map.run('k', () => Promise.resolve('v2')), 'v2')
  assert.equal(calls, 1)
})

test('InflightMap：失败也清理，且失败共享给所有等待者', async () => {
  const map = new InflightMap()
  const d = deferred()
  const a = map.run('k', () => d.promise)
  const b = map.run('k', () => d.promise)
  d.reject(new Error('boom'))
  await assert.rejects(a, /boom/)
  await assert.rejects(b, /boom/)
  assert.equal(map.size(), 0, '失败后没清理，会把错误缓存住')
  assert.equal(await map.run('k', () => Promise.resolve('ok')), 'ok')
})

test('InflightMap：task 同步抛也能被捕获且清理', async () => {
  const map = new InflightMap()
  await assert.rejects(
    map.run('k', () => {
      throw new Error('sync boom')
    }),
    /sync boom/
  )
  assert.equal(map.size(), 0)
})

test('coalesceKeyOf：只合并无 cookie、无 signal 的幂等请求', () => {
  assert.equal(coalesceKeyOf('GET', 'https://a/x', undefined, undefined), 'GET https://a/x')
  // 不同 body 不是同一个请求
  assert.notEqual(
    coalesceKeyOf('GET', 'https://a/x', 'b=1', undefined),
    coalesceKeyOf('GET', 'https://a/x', 'b=2', undefined)
  )
  // 带登录 cookie：结果因账号而异，不能合并
  assert.equal(coalesceKeyOf('GET', 'https://a/x', undefined, 'uin=1'), null)
  // POST 不合并
  assert.equal(coalesceKeyOf('POST', 'https://a/x', 'b=1', undefined), null)
  // 带 signal 不合并：否则 A 取消会把 AbortError 抛给没取消的 B
  assert.equal(coalesceKeyOf('GET', 'https://a/x', undefined, undefined, true), null)
})
