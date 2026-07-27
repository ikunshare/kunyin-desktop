export interface InferConfig {
  /**
   * Override words that already carry a language.
   * @default false
   */
  override: boolean
}

export const DEFAULT_CONFIG: InferConfig = {
  override: false
}
