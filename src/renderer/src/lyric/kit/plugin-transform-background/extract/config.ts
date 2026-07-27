export interface ExtractConfig {
  /**
   * extract full line
   * @example (this is lyric)
   * @default true
   */
  fullLine?: boolean
  /**
   * extract in line
   * @example test (will extract) test
   * @default true
   */
  inLine?: boolean
  /**
   * extract in cross-line
   * @example
   * (test
   * test)
   * @default true
   */
  crossLine?: boolean
}

export const DEFAULT_CONFIG: ExtractConfig = {
  fullLine: true,
  inLine: true,
  crossLine: true
}
