import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { app } from 'electron'
import ffmpegStatic from 'ffmpeg-static'

export function ffmpegExecutable(): string {
  if (!ffmpegStatic) throw new Error('当前平台没有内置 FFmpeg')
  return app.isPackaged
    ? ffmpegStatic.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1')
    : ffmpegStatic
}

export function ffmpegStatus(): { available: boolean; path: string } {
  try {
    const path = ffmpegExecutable()
    return { available: existsSync(path), path }
  } catch {
    return { available: false, path: '' }
  }
}

export interface AppleRemuxOptions {
  metadata?: Record<string, string>
  lyrics?: string
  coverPath?: string
}

/** 统一跑一次 FFmpeg；失败时把 stderr 前 16KB 带进异常信息。 */
async function runFfmpeg(args: string[], signal?: AbortSignal): Promise<void> {
  const executable = ffmpegExecutable()
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true, signal })
    const errors: Buffer[] = []
    child.stderr.on('data', (chunk: Buffer) => {
      if (errors.reduce((sum, part) => sum + part.length, 0) < 16384) errors.push(chunk)
    })
    child.once('error', reject)
    child.once('close', (code) => {
      if (code === 0) resolve()
      else
        reject(new Error(`FFmpeg 失败 (${code}): ${Buffer.concat(errors).toString('utf8').trim()}`))
    })
  })
}

export interface AppleFlacOptions {
  /**
   * 源音频位深（后端 /app/getUrl 回传）。只有明确 ≤16 才降到 s16；
   * 位深未知时按 s32 走——s16 编码 24bit 源会真的丢精度，反过来 s32 编 16bit 源只是白占体积。
   */
  bitDepth?: number
}

/**
 * Apple Music 无损（ALAC）→ FLAC：无损转码，不重编码有声损失。
 * 输出不写标签——下载流程随后的 fillAudioTags 会补 title/artist/album/cover/lyrics；
 * 这里只负责音频本体与位深/采样率（FFmpeg 默认保持输入采样率）。
 */
export async function convertAppleToFlac(
  input: string,
  output: string,
  signal?: AbortSignal,
  options: AppleFlacOptions = {}
): Promise<void> {
  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    input,
    '-map',
    '0:a:0',
    '-vn',
    '-c:a',
    'flac',
    '-sample_fmt',
    options.bitDepth != null && options.bitDepth <= 16 ? 's16' : 's32',
    '-f',
    'flac',
    output
  ]
  await runFfmpeg(args, signal)
}

export async function remuxAppleMp4(
  input: string,
  output: string,
  signal?: AbortSignal,
  options: AppleRemuxOptions = {}
): Promise<void> {
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-i', input]
  if (options.coverPath) args.push('-i', options.coverPath)
  args.push('-map', '0:a:0')
  if (options.coverPath) args.push('-map', '1:v:0')
  args.push('-c:a', 'copy')
  if (options.coverPath) {
    args.push(
      '-c:v',
      'mjpeg',
      '-disposition:v:0',
      'attached_pic',
      '-metadata:s:v:0',
      'title=Album cover',
      '-metadata:s:v:0',
      'comment=Cover (front)'
    )
  }
  for (const [key, value] of Object.entries(options.metadata ?? {})) {
    if (value) args.push('-metadata', `${key}=${value}`)
  }
  if (options.lyrics) args.push('-metadata', `lyrics=${options.lyrics}`)
  args.push('-movflags', '+faststart', '-f', 'mp4', output)
  await runFfmpeg(args, signal)
}
