/**
 * 逐行 LRC 解析（src/renderer/src/utils/lrcLines.ts）的回归，蓝牙歌词靠它取当前一句。
 *
 * 跑：npm test
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { lineIndexAt, parseLrcLines } from '../src/renderer/src/utils/lrcLines.ts'

test('基本解析：时间折算、元信息跳过、按时间排序', () => {
  const lines = parseLrcLines(
    ['[ti:歌名]', '[ar:歌手]', '[00:12.34]第二句', '[00:01.5]第一句', '[01:02.345]第三句'].join(
      '\n'
    )
  )
  assert.deepEqual(lines, [
    { time: 1500, text: '第一句' },
    { time: 12340, text: '第二句' },
    { time: 62345, text: '第三句' }
  ])
})

test('一行多个时间标签展开成多条', () => {
  const lines = parseLrcLines('[00:10.00][01:20.00]副歌\n[00:30.00]主歌')
  assert.deepEqual(
    lines.map((l) => [l.time, l.text]),
    [
      [10000, '副歌'],
      [30000, '主歌'],
      [80000, '副歌']
    ]
  )
})

test('剥掉行内逐字标签，保留空行作为间奏', () => {
  const lines = parseLrcLines(
    '[00:01.00]<00:01.00>你<00:01.50>好\r\n[00:03.00]<3000,200,0>再<3200,300,0>见\n[00:05.00]'
  )
  assert.deepEqual(lines, [
    { time: 1000, text: '你好' },
    { time: 3000, text: '再见' },
    { time: 5000, text: '' }
  ])
})

test('[offset:] 正值让歌词提前，且不减成负数', () => {
  const lines = parseLrcLines('[offset:+500]\n[00:00.20]a\n[00:02.00]b')
  assert.deepEqual(
    lines.map((l) => l.time),
    [0, 1500]
  )
})

test('[mm:ss:xx] 冒号小数与无小数', () => {
  assert.deepEqual(
    parseLrcLines('[00:02:50]a\n[00:04]b').map((l) => l.time),
    [2500, 4000]
  )
})

test('lineIndexAt：第一行之前 -1，边界含起点', () => {
  const lines = parseLrcLines('[00:01.00]a\n[00:03.00]b\n[00:05.00]c')
  assert.equal(lineIndexAt(lines, 0), -1)
  assert.equal(lineIndexAt(lines, 999), -1)
  assert.equal(lineIndexAt(lines, 1000), 0)
  assert.equal(lineIndexAt(lines, 4999), 1)
  assert.equal(lineIndexAt(lines, 99999), 2)
  assert.equal(lineIndexAt([], 1000), -1)
})
