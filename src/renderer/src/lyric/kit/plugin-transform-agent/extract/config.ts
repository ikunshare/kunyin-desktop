export interface ExtractConfig {
  split: string | RegExp
  /**
   * replace name when matched
   * @default true
   */
  replace: boolean
}

export const DEFAULT_CONFIG: ExtractConfig = {
  split: '/',
  replace: true
}
