import type { ValueOf } from '../utils'

export const INSERT_TEXT_SPACE_TYPES = {
  ALL: 'ALL',

  // e.g. ABC中文 -> ABC 中文
  CJK_ENGLISH: 'CJK_ENGLISH',
  // e.g. 2026年 -> 2026 年
  CJK_NUMBER: 'CJK_NUMBER',

  // , ; ! ? :
  PUNCTUATION: 'PUNCTUATION',
  // " ' “ ”
  QUOTE: 'QUOTE',
  //  ( [ { <
  BRACKET_OUTSIDE: 'BRACKET_OUTSIDE',

  // + = &
  MATH_OPERATOR: 'MATH_OPERATOR',
  // -
  HYPHEN: 'HYPHEN',
  // /
  SLASH: 'SLASH',

  // a   b -> a b
  COMPRESS_SPACES: 'COMPRESS_SPACES',
  // [ a ] -> [a]
  TRIM_INSIDE_SYMBOLS: 'TRIM_INSIDE_SYMBOLS'
} as const

export type InsertTextSpaceTypes = ValueOf<typeof INSERT_TEXT_SPACE_TYPES>

export const INSERT_TEXT_SPACE_TYPES_VALUE = Object.values(
  INSERT_TEXT_SPACE_TYPES
) as InsertTextSpaceTypes[]
