/**
 * 歌词/封面重定向查询 IPC（RedirectDialog 用）。
 * 对应安卓 SongRedirectDialog 的 lookup / kgLyricSearch 两条能力：
 * - lookup：QQ 按 id 或 mid、网易云/酷我按 id 查单曲，返回完整 MusicItem 供预览与保存；
 * - kgSearch：酷狗歌词候选搜索，并行探测每条的歌词内容类型徽标（需逐条下载解析）。
 */
import { IpcChannels, type KgLyricCandidate, type MusicItem } from '@common'
import { handle } from '../helpers'
import { getProvider } from '../../providers'
import type { QqProvider } from '../../providers/qq'
import type { WyProvider } from '../../providers/wy'
import type { KwProvider } from '../../providers/kw'
import { probeKgLyricTypes, searchKgLyricCandidates } from '../../providers/kg/lyric'

export function registerRedirectHandlers(): void {
  handle(
    IpcChannels.REDIRECT_LOOKUP,
    async (
      source: 'qq' | 'wy' | 'kw',
      key: 'id' | 'mid',
      value: string
    ): Promise<MusicItem | null> => {
      const v = value.trim()
      if (!v) return null
      if (source === 'qq') {
        const qq = getProvider('qq') as QqProvider | undefined
        if (!qq) return null
        if (key === 'mid') return qq.fromMid(v)
        const id = Number(v)
        return Number.isFinite(id) && id > 0 ? qq.fromId(id) : null
      }
      const id = Number(v)
      if (!Number.isFinite(id) || id <= 0) return null
      if (source === 'wy') return (getProvider('wy') as WyProvider | undefined)?.fromId(id) ?? null
      if (source === 'kw') return (getProvider('kw') as KwProvider | undefined)?.fromId(id) ?? null
      return null
    }
  )

  handle(
    IpcChannels.REDIRECT_KG_SEARCH,
    async (keyword: string, durationMs: number): Promise<KgLyricCandidate[]> => {
      const candidates = await searchKgLyricCandidates(
        keyword,
        durationMs,
        undefined,
        undefined,
        true
      ).catch(() => [])
      // 并行探测内容类型（每条一次下载；候选一般 <20 条，可接受）
      await Promise.all(
        candidates.map(async (c) => {
          c.typeBadges = await probeKgLyricTypes(c).catch(() => [])
        })
      )
      return candidates
    }
  )
}
