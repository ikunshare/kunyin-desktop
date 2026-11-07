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

export async function remuxAppleMp4(
  input: string,
  output: string,
  signal?: AbortSignal,
  options: AppleRemuxOptions = {}
): Promise<void> {
  const executable = ffmpegExecutable()
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
        reject(
          new Error(`FFmpeg 重封装失败 (${code}): ${Buffer.concat(errors).toString('utf8').trim()}`)
        )
    })
  })
}
