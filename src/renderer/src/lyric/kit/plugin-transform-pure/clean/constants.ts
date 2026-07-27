import type { MatchRule, MatchRuleGroup } from '../utils/match'

const DEFAULT_FUZZY_RULES: MatchRule[] = [
  '版权所有',
  '未经授权',
  '未经许可',
  '版权归原作者所有',
  'All rights reserved',
  'Unauthorized reproduction'
]

const DEFAULT_EXACT_RULES: MatchRule[] = [
  ...DEFAULT_FUZZY_RULES,
  '版权',
  '授权',
  'Copyright',
  'License',
  '翻唱',
  '改编',
  '致敬',
  'Cover',
  'Adaptation',
  'Tribute',
  'Remake'
]

export const DEFAULT_RULES: MatchRuleGroup = {
  fuzzy: DEFAULT_FUZZY_RULES,
  exact: DEFAULT_EXACT_RULES
}
