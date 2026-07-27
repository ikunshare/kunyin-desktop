import type * as Syllable from './syllable'

/**
 * The main vocal line: its rendering mode and per‑mode settings.
 */
export interface Main {
  /**
   * Which renderer the main line uses.
   * - `syllable`: word‑by‑word karaoke highlighting. A preference — lyrics without syllable timing always fall back to plain.
   * - `plain`: the whole line as plain text with only the normal / active / played state styles.
   * @default 'syllable'
   */
  use?: 'syllable' | 'plain'
  /**
   * Syllable (karaoke) settings.
   */
  syllable?: Syllable.Root
}
