import type { MatchOptions } from '../utils/match'

export interface CleanConfig extends MatchOptions {
  /**
   * use music info when clean first line
   * @example song name - song singer -> will be remove
   * @example song lyric -> skip
   * @default true
   */
  firstLineWithMusicInfo: boolean
}

export const DEFAULT_CONFIG: CleanConfig = {
  mode: 'exact',
  fuzzy: {},
  exact: {
    check: 40
  },
  rule: {
    useDefault: true,
    custom: []
  },
  firstLineWithMusicInfo: true
}
