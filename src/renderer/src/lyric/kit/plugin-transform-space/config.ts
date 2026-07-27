import type { InsertTextSpaceTypes } from './constants'
import { INSERT_TEXT_SPACE_TYPES } from './constants'

export interface SpaceConfig {
  /**
   * insert original line
   * @default true
   */
  original: boolean
  /**
   * insert entended
   * @default true
   */
  extended: boolean
  /**
   * insert types
   * @default all
   */
  types: InsertTextSpaceTypes[]
}

export const DEFAULT_CONFIG: SpaceConfig = {
  original: true,
  extended: true,
  types: [INSERT_TEXT_SPACE_TYPES.ALL]
}
