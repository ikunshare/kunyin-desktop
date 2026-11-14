/**
 * Apple Music TTML → ELRC 的回归（src/main/modules/download/ttmlElrc.ts）。
 *
 * 跑：npm test
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { ttmlToElrc } from '../src/main/modules/download/ttmlElrc.ts'

const wrap = (body, head = '') =>
  `<?xml version="1.0" encoding="UTF-8"?>
<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xmlns:itunes="http://music.apple.com/lyric-ttml-internal">
  <head>${head}</head>
  <body>
    <div>
${body}
    </div>
  </body>
</tt>`

test('逐字行：行标签取 p.begin，词标签取 span.begin，行尾补最后一个词的 end', () => {
  const ttml = wrap(
    `<p begin="12.345" end="15.000" ttm:agent="v1"><span begin="12.345" end="12.600">你</span><span begin="12.600" end="13.200">好</span></p>`
  )
  assert.equal(ttmlToElrc(ttml), '[00:12.345]<00:12.345>你<00:12.600>好<00:13.200>')
})

test('纯文本行（无 span 时间）：只出 [mm:ss.xxx]正文', () => {
  const ttml = wrap(`<p begin="0:01.500" end="0:04.000">前奏 paragraph</p>`)
  assert.equal(ttmlToElrc(ttml), '[00:01.500]前奏 paragraph')
})

test('x-bg / x-translation / x-roman 注释轨不混进唱词', () => {
  const ttml = wrap(
    `<p begin="1.000" end="4.000"><span begin="1.000" end="2.000">主</span>` +
      `<span ttm:role="x-bg" begin="2.000" end="3.000"><span begin="2.000" end="3.000">和声</span></span>` +
      `<span begin="3.000" end="3.500">句</span></p>` +
      `<p begin="1.000" end="4.000"><span ttm:role="x-translation" begin="1.000" end="4.000">translation</span>` +
      `<span begin="1.000" end="2.000">主</span></p>`
  )
  const out = ttmlToElrc(ttml)
  assert.equal(out.split('\n')[0], '[00:01.000]<00:01.000>主<00:03.000>句<00:03.500>')
  assert.equal(out.split('\n')[1], '[00:01.000]<00:01.000>主<00:02.000>')
  assert.ok(!out.includes('和声'))
  assert.ok(!out.includes('translation'))
})

test('metadata 里的 <p>（词曲信息）不算唱词', () => {
  const ttml = wrap(
    `<p begin="0.000" end="1.000">真正的唱词</p>`,
    `<metadata><iTunesMetadata><translations><translation xml:lang="zh"><text for="L1">译</text></translation></translations></iTunesMetadata></metadata>`
  )
  assert.equal(ttmlToElrc(ttml), '[00:00.000]真正的唱词')
})

test('无 end 时以最后一个词的 begin 收尾，不产生 NaN', () => {
  const ttml = wrap(`<p begin="2.000"><span begin="2.000">a</span><span begin="2.500">b</span></p>`)
  assert.equal(ttmlToElrc(ttml), '[00:02.000]<00:02.000>a<00:02.500>b<00:02.500>')
})

test('实体还原与 dur 写法', () => {
  const ttml = wrap(`<p begin="1.000" dur="2.000" end="3.000">A &amp; B &lt;3</p>`)
  assert.equal(ttmlToElrc(ttml), '[00:01.000]A & B <3')
})

test('空串 / 无唱词返回空串（调用方回退 lrc）', () => {
  assert.equal(ttmlToElrc(''), '')
  assert.equal(ttmlToElrc(wrap('')), '')
})

test('h:mm:ss.fff 与 s / ms 单位都能解析', () => {
  const ttml = wrap(
    `<p begin="1:02:03.500" end="1:02:04.000">x</p><p begin="1500ms" end="2s">y</p>`
  )
  assert.equal(ttmlToElrc(ttml), '[62:03.500]x\n[00:01.500]y')
})
