import { IpcChannels, type MusicListResult, type MusicSource } from '@common'
import { handle } from '../helpers'
import { getProvider } from '../../providers'

/** 搜索相关 IPC —— 分发到主进程各音源 Provider */
export function registerSearchHandlers(): void {
  handle(
    IpcChannels.SEARCH_SONGS,
    (
      source: MusicSource,
      keyword: string,
      page: number = 0,
      size: number = 20
    ): Promise<MusicListResult> => {
      const provider = getProvider(source)
      if (!provider) {
        return Promise.resolve({ source, hasNext: false, page, size, result: [] })
      }
      return provider.search(keyword, page, size)
    }
  )
  handle(IpcChannels.SEARCH_HOT, async (source: MusicSource): Promise<string[]> => {
    return (await getProvider(source)?.getHotSearch()) ?? []
  })
  handle(
    IpcChannels.SEARCH_TIP,
    async (source: MusicSource, keyword: string): Promise<string[]> => {
      return (await getProvider(source)?.getSearchTip(keyword)) ?? []
    }
  )
}
