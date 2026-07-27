import type { MatchOptions } from '../utils/match'

export interface ExtractCreatorConfig {
  match: MatchOptions
  /**
   * split name
   */
  split: string | RegExp
  /**
   * is replace this line when matched
   * @default true
   */
  replace: boolean
}

export const DEFAULT_CREATOR_CONFIG: ExtractCreatorConfig = {
  match: {
    mode: 'exact',
    fuzzy: {},
    exact: {
      check: 50
    },
    rule: {
      useDefault: true,
      custom: []
    }
  },
  split: '/',
  replace: true
}
