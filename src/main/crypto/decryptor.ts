/**
 * 音频流解密器统一分发：按 EncryptionInfo.cipher 选算法（缺省 mflac，兼容既有 QQ 流）。
 * 播放（audio/protocol 边下边解密）与下载（整文件原地解密）共用。
 */
import type { AudioCipher } from '@common'
import { createMflacDecryptor, decryptFile as decryptFileMflac, type AudioDecryptor } from './mflac'
import { createAesCtrDecryptor, decryptFileAesCtr, SP_HEADER_SIZE } from './aesctr'

export type { AudioDecryptor } from './mflac'

export function createAudioDecryptor(
  cipher: AudioCipher | undefined,
  ekey: string
): AudioDecryptor | null {
  return cipher === 'aes-ctr' ? createAesCtrDecryptor(ekey) : createMflacDecryptor(ekey)
}

/**
 * 该加密方案在真实音频前内嵌的伪造头长度（字节）。
 * 流式播放时上游 Range/解密偏移都要整体平移这个量；Spotify 为 0xa7，QQ 无头为 0。
 */
export function cipherHeaderSize(cipher: AudioCipher | undefined): number {
  return cipher === 'aes-ctr' ? SP_HEADER_SIZE : 0
}

export async function decryptAudioFile(
  filePath: string,
  cipher: AudioCipher | undefined,
  ekey: string
): Promise<void> {
  return cipher === 'aes-ctr' ? decryptFileAesCtr(filePath, ekey) : decryptFileMflac(filePath, ekey)
}
