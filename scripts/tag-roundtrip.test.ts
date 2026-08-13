/**
 * 标签库往返验证脚本（开发用，不入产品代码）。
 * 合成最小合法 mp3/flac/ogg 文件 → editAudioTags 写入 → readAudioTags 读回，
 * 并用 music-metadata 独立解析交叉验证；Ogg 输出再独立实现 CRC 校验。
 *
 * 运行：npx esbuild scripts/tag-roundtrip.test.ts --bundle --platform=node \
 *        --format=esm --external:music-metadata --outfile=scripts/.tag-test.mjs && \
 *        node scripts/.tag-test.mjs
 */
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { crc32, deflateSync } from 'node:zlib'
import { editAudioTags, fillAudioTags, readAudioTags, type MusicMeta } from '../src/main/tag'

const DIR = join(process.cwd(), 'scripts', '.tag-test-data')
mkdirSync(DIR, { recursive: true })

const META: MusicMeta = {
  title: '新标题 Title',
  artist: '艺术家 Artist',
  album: '专辑 Album',
  trackNumber: 7,
  lyrics: '[00:01.00]第一句歌词',
  pictureData: fakePng(320, 240),
  pictureMimeType: 'image/png'
}

// —— 合成文件构造 ——

/** 生成真实合法的最小 PNG（zlib 压缩 IDAT + 标准 CRC） */
function fakePng(w: number, h: number): Buffer {
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length, 0)
    const t = Buffer.from(type, 'latin1')
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0)
    return Buffer.concat([len, t, data, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  const raw = Buffer.alloc(1 + w * h * 4) // filter 0 + 全零像素
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ])
}

function id3TextFrame(id: string, text: string): Buffer {
  const body = Buffer.concat([Buffer.from([1, 0xff, 0xfe]), Buffer.from(text, 'utf16le')])
  const out = Buffer.alloc(10 + body.length)
  out.write(id, 0, 'latin1')
  out.writeUInt32BE(body.length, 4)
  body.copy(out, 10)
  return out
}

/** 带旧 ID3v2.3 标签的 mp3（TIT2=Old Title）+ 假音频字节 */
function makeMp3(): Buffer {
  const frame = id3TextFrame('TIT2', 'Old Title')
  const header = Buffer.alloc(10)
  header.write('ID3', 0, 'latin1')
  header[3] = 3
  header[6] = (frame.length >>> 21) & 0x7f
  header[7] = (frame.length >>> 14) & 0x7f
  header[8] = (frame.length >>> 7) & 0x7f
  header[9] = frame.length & 0x7f
  return Buffer.concat([header, frame, Buffer.from([0xff, 0xfb, 0x90, 0x00, 0x01, 0x02])])
}

/** FLAC：fLaC + 合法 STREAMINFO(44100Hz/16bit/2ch) + 旧 VORBIS_COMMENT + 旧 PICTURE */
function flacBlock(type: number, payload: Buffer, isLast: boolean): Buffer {
  const header = Buffer.alloc(4)
  header[0] = (type & 0x7f) | (isLast ? 0x80 : 0)
  header.writeUIntBE(payload.length, 1, 3)
  return Buffer.concat([header, payload])
}

function makeStreamInfo(): Buffer {
  const si = Buffer.alloc(34)
  si.writeUInt16BE(4096, 0)
  si.writeUInt16BE(4096, 2)
  // 20bit 44100 | 3bit channels-1=1 | 5bit bps-1=15 | 36bit totalSamples=0
  si[10] = 0x0a
  si[11] = 0xc4
  si[12] = 0x42
  si[13] = 0xf0
  return si
}

function vorbisPayload(vendor: string, comments: string[]): Buffer {
  const parts: Buffer[] = []
  const v = Buffer.from(vendor, 'utf8')
  parts.push(u32le(v.length), v, u32le(comments.length))
  for (const c of comments) {
    const cb = Buffer.from(c, 'utf8')
    parts.push(u32le(cb.length), cb)
  }
  return Buffer.concat(parts)
}

function u32le(v: number): Buffer {
  const b = Buffer.alloc(4)
  b.writeUInt32LE(v, 0)
  return b
}

function picturePayload(data: Buffer, w: number, h: number): Buffer {
  const mime = Buffer.from('image/png', 'utf8')
  const out = Buffer.alloc(4 * 5 + 4 + mime.length + data.length)
  let o = 0
  o = out.writeUInt32BE(3, o) // 封面
  o = out.writeUInt32BE(mime.length, o)
  mime.copy(out, o)
  o += mime.length
  o = out.writeUInt32BE(0, o) // description 空
  o = out.writeUInt32BE(w, o)
  o = out.writeUInt32BE(h, o)
  o = out.writeUInt32BE(32, o)
  o = out.writeUInt32BE(0, o)
  o = out.writeUInt32BE(data.length, o)
  data.copy(out, o)
  return out
}

function makeFlac(): Buffer {
  const parts: Buffer[] = [Buffer.from('fLaC', 'latin1')]
  parts.push(flacBlock(0, makeStreamInfo(), false))
  parts.push(flacBlock(1, Buffer.alloc(0), false)) // 0 长度 padding 块
  parts.push(flacBlock(4, vorbisPayload('libFLAC', ['TITLE=Old Title']), false))
  parts.push(flacBlock(6, picturePayload(fakePng(10, 10), 10, 10), true))
  return Buffer.concat(parts)
}

/** Ogg Opus：OpusHead + [评论包 + 尾随音频段] + EOS 音频页（CRC 置 0，写路径会重算） */
function oggPage(
  headerType: number,
  seq: number,
  segmentTable: number[],
  body: Buffer,
  granule = 0n
): Buffer {
  const seg = Buffer.from(segmentTable)
  const raw = Buffer.alloc(27 + seg.length + body.length)
  raw.write('OggS', 0, 'latin1')
  raw[5] = headerType
  raw.writeBigUInt64LE(granule, 6)
  raw.writeUInt32LE(0x3039, 14)
  raw.writeUInt32LE(seq, 18)
  raw[26] = seg.length
  seg.copy(raw, 27)
  body.copy(raw, 27 + seg.length)
  return raw
}

function makeOpusHead(): Buffer {
  return Buffer.concat([
    Buffer.from('OpusHead', 'latin1'),
    Buffer.from([0x01, 0x02, 0x38, 0x01, 0x80, 0xbb, 0x00, 0x00, 0x00, 0x00, 0x00])
  ])
}

function makeOgg(): Buffer {
  const comment = Buffer.concat([
    Buffer.from('OpusTags', 'latin1'),
    vorbisPayload('libopus', ['TITLE=Old Title'])
  ])
  const audio1 = Buffer.alloc(10, 0x55)
  const audio2 = Buffer.alloc(5, 0x66)
  return Buffer.concat([
    oggPage(0x02, 0, [19], makeOpusHead()),
    oggPage(0x00, 1, [comment.length, audio1.length], Buffer.concat([comment, audio1])),
    oggPage(0x04, 2, [audio2.length], audio2, 960n)
  ])
}

// —— 独立 Ogg CRC 参考实现（表驱动 vs 位运算交叉验证） ——

function oggCrcRef(data: Buffer): number {
  let crc = 0
  for (const b of data) {
    crc ^= b << 24
    for (let i = 0; i < 8; i++) {
      crc = (crc & 0x80000000) !== 0 ? ((crc << 1) ^ 0x04c11db7) >>> 0 : (crc << 1) >>> 0
    }
  }
  return crc >>> 0
}

function verifyOggCrc(filePath: string): void {
  const data = readFileSync(filePath)
  let offset = 0
  let pages = 0
  while (offset + 27 <= data.length) {
    if (data.toString('latin1', offset, offset + 4) !== 'OggS') {
      assert.fail(`Ogg 输出页 ${pages} capture 丢失 @${offset}`)
    }
    const numSegments = data[offset + 26]
    const table = data.subarray(offset + 27, offset + 27 + numSegments)
    let bodySize = 0
    for (const s of table) bodySize += s
    const page = data.subarray(offset, offset + 27 + numSegments + bodySize)
    const stored = page.readUInt32LE(22)
    page.writeUInt32LE(0, 22)
    const expect = oggCrcRef(page)
    assert.equal(stored, expect, `Ogg 输出页 ${pages} CRC 不符`)
    offset += page.length
    pages++
  }
  assert.equal(offset, data.length, 'Ogg 输出尾部有多余字节')
  assert.ok(pages >= 3, 'Ogg 输出页数异常')
}

// —— 主流程 ——

async function roundtrip(ext: string, source: Buffer, extraVerify?: (p: string) => void) {
  const path = join(DIR, `sample${ext}`)
  writeFileSync(path, source)

  await editAudioTags(path, META)

  const back = await readAudioTags(path)
  assert.ok(back, `${ext} 读回为空`)
  assert.equal(back.title, META.title)
  assert.equal(back.artist, META.artist)
  assert.equal(back.album, META.album)
  assert.equal(back.trackNumber, META.trackNumber)
  assert.equal(back.lyrics, META.lyrics)
  assert.ok(back.pictureData && back.pictureData.equals(META.pictureData as Buffer), '封面不一致')
  assert.equal(back.pictureMimeType, 'image/png')

  if (extraVerify) extraVerify(path)

  // music-metadata 独立解析交叉验证
  const mm = await import('music-metadata')
  const parsed = await mm.parseFile(path, { duration: false })
  assert.equal(parsed.common.title, META.title, `${ext} mm.title`)
  assert.equal(parsed.common.artist, META.artist, `${ext} mm.artist`)
  assert.equal(parsed.common.album, META.album, `${ext} mm.album`)
  const pic = parsed.common.picture?.[0]
  assert.ok(pic, `${ext} mm 无封面`)
  assert.equal(pic.format, 'image/png')
  console.log(`✓ ${ext} 往返 + music-metadata 交叉验证通过`)
}

async function main(): Promise<void> {
  await roundtrip('.mp3', makeMp3())
  await roundtrip('.flac', makeFlac(), (p) => {
    // 替换后 STREAMINFO 仍在首位且 last 标志只在末块
    const data = readFileSync(p)
    assert.equal(data.toString('latin1', 0, 4), 'fLaC')
    assert.equal(data[4] & 0x7f, 0, 'FLAC 首块应为 STREAMINFO')
    assert.equal(data[4] & 0x80, 0, 'STREAMINFO 不应带 last 标志')
  })
  await roundtrip('.ogg', makeOgg(), verifyOggCrc)

  // FLAC 音频帧尾部（last 块之后的数据）流式复制验证
  const tail = Buffer.from([0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc])
  const tailPath = join(DIR, 'tail.flac')
  writeFileSync(tailPath, Buffer.concat([makeFlac(), tail]))
  await editAudioTags(tailPath, { title: '尾巴' })
  assert.ok(readFileSync(tailPath).subarray(-tail.length).equals(tail), 'FLAC 音频尾部字节未保留')
  assert.equal((await readAudioTags(tailPath))?.title, '尾巴')
  console.log('✓ FLAC 音频尾部流式复制通过')

  // fillAudioTags：自带标签保留、缺失字段补齐
  const fillPath = join(DIR, 'fill.mp3')
  writeFileSync(fillPath, makeMp3()) // 自带 TITLE=Old Title
  await fillAudioTags(fillPath, {
    title: '任务表标题',
    artist: '任务表艺术家',
    album: '任务表专辑',
    trackNumber: 9,
    lyrics: '任务表歌词',
    pictureData: fakePng(320, 240),
    pictureMimeType: 'image/png'
  })
  const filled = await readAudioTags(fillPath)
  assert.equal(filled?.title, 'Old Title', '自带标题应保留')
  assert.equal(filled?.artist, '任务表艺术家', '缺失艺术家应补齐')
  assert.equal(filled?.album, '任务表专辑')
  assert.equal(filled?.trackNumber, 9)
  assert.equal(filled?.lyrics, '任务表歌词')
  assert.ok(filled?.pictureData?.equals(fakePng(320, 240)), '缺失封面应补齐')
  console.log('✓ 补齐模式（mp3）：自带标签保留、缺失字段补齐通过')

  const fillFlac = join(DIR, 'fill.flac')
  writeFileSync(fillFlac, makeFlac()) // 自带 TITLE=Old Title + 封面
  await fillAudioTags(fillFlac, { artist: '新艺术家' })
  const f = await readAudioTags(fillFlac)
  assert.equal(f?.title, 'Old Title')
  assert.equal(f?.artist, '新艺术家')
  assert.ok(f?.pictureData, '原有封面应保留')
  assert.equal(f?.pictureMimeType, 'image/png')
  console.log('✓ 补齐模式（flac）：部分字段补齐、封面保留通过')

  // 无旧标签的 mp3（前面无 ID3，直接前置新标签）
  const bare = join(DIR, 'bare.mp3')
  writeFileSync(bare, Buffer.from([0xff, 0xfb, 0x90, 0x00]))
  await editAudioTags(bare, { title: '裸文件' })
  const back = await readAudioTags(bare)
  assert.equal(back?.title, '裸文件')
  const mm = await import('music-metadata')
  assert.equal((await mm.parseFile(bare, { duration: false })).common.title, '裸文件')
  console.log('✓ 无旧标签 mp3 前置写入通过')

  console.log('全部通过 ✓')
}

main()
  .catch((e) => {
    console.error('FAILED:', e)
    process.exitCode = 1
  })
  .finally(() => rmSync(DIR, { recursive: true, force: true }))
