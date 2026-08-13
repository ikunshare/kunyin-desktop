/**
 * 音频流解密器统一分发。当前仅 QQ mflac/mgg（QMC2）；
 * Spotify 已移除，其 AES-128-CTR 解密器（crypto/aesctr.ts）随之删除。
 * 播放（audio/protocol 边下边解密）与下载（整文件原地解密）共用。
 */
import { createMflacDecryptor, decryptFile as decryptFileMflac, type AudioDecryptor } from './mflac'

export type { AudioDecryptor } from './mflac'

export function createAudioDecryptor(ekey: string): AudioDecryptor | null {
  return createMflacDecryptor(ekey)
}

export async function decryptAudioFile(filePath: string, ekey: string): Promise<void> {
  return decryptFileMflac(filePath, ekey)
}
