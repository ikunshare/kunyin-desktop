export interface CalculateConfig {
  /**
   * Include background vocals when computing the language share.
   * @default false
   */
  background: boolean
}

export const DEFAULT_CONFIG: CalculateConfig = {
  background: false
}
