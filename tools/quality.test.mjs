/**
 * 音质档位（src/common/constants.ts）的回归：只能下载的杜比 / Audio Vivid 不能漏进播放与常规降级
 * （能软解的网易 / QQ 杜比除外，且只在明确选了时才播），各平台的档位叫法不能串。
 *
 * 跑：npm test
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  QUALITY_IDS,
  blockedQualityIds,
  playbackBlockedQualityIds,
  qualityBadge,
  qualityFallbackOrder,
  qualityName,
  qualityUpgradeOrder,
  softDecoder
} from '../src/common/constants.ts'

const settings = (blockAi, aiQualities = ['atmos']) => ({ quality: { blockAi, aiQualities } })
const all = Object.fromEntries(QUALITY_IDS.map((id) => [id, {}]))

test('从任何常规档往下降级都掉不进杜比 / Audio Vivid', () => {
  for (const target of ['master', 'atmos', 'atmos_plus', 'hires', 'flac']) {
    const order = qualityFallbackOrder(target, all)
    assert.ok(!order.includes('dolby') && !order.includes('vivid'), `${target} → ${order}`)
  }
})

test('播放侧：关掉 AI 屏蔽也不取杜比 / Audio Vivid（Chromium 解不了）', () => {
  const blocked = playbackBlockedQualityIds(settings(false))
  assert.deepEqual(qualityFallbackOrder('master', all, blocked)[0], 'master')
  // 首选档以下全没有时向上兜底，也不能兜到它们
  const onlySpecial = { dolby: {}, vivid: {}, master: {} }
  assert.deepEqual(qualityUpgradeOrder('flac', onlySpecial, blocked), ['master'])
  // 开着 AI 屏蔽时两者叠加
  assert.ok(playbackBlockedQualityIds(settings(true)).includes('atmos'))
})

test('列表徽标不显示听不到的档位', () => {
  const blocked = playbackBlockedQualityIds(settings(false))
  assert.equal(qualityBadge({ dolby: {}, vivid: {}, hires: {} }, blocked)?.label, 'HiRes')
})

test('下载侧：明确选了杜比才下杜比，没有就往下落到母带', () => {
  assert.deepEqual(qualityFallbackOrder('dolby', { dolby: {}, master: {} }), ['dolby', 'master'])
  assert.deepEqual(qualityFallbackOrder('dolby', { master: {}, flac: {} }), ['master', 'flac'])
})

test('各平台叫法：网易沉浸环绕声是 atmos（sk/sky），不是 Android 标的高清臻音', () => {
  assert.equal(qualityName('atmos', 'wy'), '沉浸环绕声')
  assert.equal(qualityName('master', 'wy'), '超清母带')
  assert.equal(qualityName('atmos_plus', 'wy'), '高清臻音')
  assert.equal(qualityName('dolby', 'wy'), '杜比全景声')
  assert.equal(qualityName('vivid', 'wy'), '臻音全景声')
  assert.equal(qualityName('atmos', 'kw'), '至臻全景声')
  assert.equal(qualityName('master', 'kw'), '至臻母带')
  assert.equal(qualityName('master', 'kg'), '蝰蛇超清')
  // QQ / JOOX 与跨平台场合用通用名；未知键原样返回
  assert.equal(qualityName('atmos', 'qq'), '臻品全景声')
  assert.equal(qualityName('master'), '臻品母带')
  assert.equal(qualityName('flac', 'wy'), '无损音质 FLAC')
  assert.equal(qualityName('unknown', 'wy'), 'unknown')
})

test('atmos_plus 只认网易：存量 QQ / 酷我歌上的旧「全景声 2.0」键不能冒充高清臻音', () => {
  const off = settings(false)
  const stale = { atmos_plus: {}, flac: {} }
  assert.ok(!blockedQualityIds(off, 'wy').includes('atmos_plus'))
  for (const source of ['qq', 'qqc', 'kw', 'kg', 'joox']) {
    const blocked = playbackBlockedQualityIds(off, source)
    assert.deepEqual(qualityFallbackOrder('atmos', stale, blocked), ['flac'], source)
    assert.equal(qualityBadge(stale, blocked)?.label, 'SQ', source)
    assert.ok(blockedQualityIds(off, source).includes('atmos_plus'), source)
  }
  // 网易：没屏蔽 AI 时高清臻音正常参与降级，沉浸环绕声之下、HiRes 之上
  assert.deepEqual(qualityFallbackOrder('master', all, playbackBlockedQualityIds(off, 'wy')), [
    'master',
    'atmos',
    'atmos_plus',
    'hires',
    'flac',
    '320k',
    '128k'
  ])
  // 默认开着 AI 屏蔽时两档都跳过
  assert.ok(blockedQualityIds(settings(true, ['atmos', 'atmos_plus']), 'wy').includes('atmos_plus'))
})

test('杜比能软解：网易 / QQ 播放侧放开，其余平台与跨平台场合照旧跳过', () => {
  const off = settings(false)
  for (const source of ['wy', 'qq', 'qqc']) {
    assert.equal(softDecoder('dolby', source), 'dolby', source)
    const blocked = playbackBlockedQualityIds(off, source)
    assert.ok(!blocked.includes('dolby'), source)
    // Audio Vivid 还没有解码器
    assert.ok(blocked.includes('vivid'), source)
  }
  for (const source of ['kg', 'kw', 'joox', undefined]) {
    assert.equal(softDecoder('dolby', source), undefined, String(source))
    assert.ok(playbackBlockedQualityIds(off, source).includes('dolby'), String(source))
  }
  assert.equal(softDecoder('flac', 'qq'), undefined)
})

test('QQ 杜比：常规降级仍掉不进去，只在首选档以下全没有时才兜到它', () => {
  const blocked = playbackBlockedQualityIds(settings(false), 'qq')
  const song = { dolby: {}, master: {}, flac: {}, '128k': {} }
  assert.deepEqual(qualityFallbackOrder('master', song, blocked), ['master', 'flac', '128k'])
  assert.deepEqual(qualityUpgradeOrder('flac', { dolby: {}, '128k': {} }, blocked), ['dolby'])
})

test('徽标不拿杜比盖掉母带 / HiRes，哪怕它能播', () => {
  const blocked = playbackBlockedQualityIds(settings(false), 'qq')
  assert.equal(qualityBadge({ dolby: {}, master: {}, hires: {} }, blocked)?.label, '母带')
  assert.equal(qualityBadge({ dolby: {}, flac: {} }, blocked)?.label, 'SQ')
})
