export interface MarkConfig {
  /**
   * If these conditions are met, add an interlude.
   * @default 3000
   */
  checkTime: number
}

export const DEFAULT_CONFIG: MarkConfig = {
  checkTime: 3000
}
