/**
 * Duet mode configuration for the layout.
 *
 * When enabled, lines may be positioned independently based on their
 * `agent` (e.g. primary voice on the left, secondary on the right).
 * Right now this slice only carries an on/off switch; per‑agent
 * alignment and other duet‑specific options will be added later.
 */
export interface Duet {
  /**
   * Whether duet mode is enabled.
   *
   * When `false`, every line falls back to `layout.align`.
   * When `true`, downstream rendering may apply per‑agent layout
   * overrides (configured via fields added in the future).
   *
   * @default true
   */
  enabled?: boolean
}
