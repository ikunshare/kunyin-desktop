import type { Lyric } from '../../../kit/lyric'

/**
 * Built‑in fallback language tag, used when no level of a resolution chain sets one.
 */
export const DEFAULT_LANGUAGE: Lyric.LanguageTag = 'zh-hans'

/**
 * Resolve the preferred annotation language from a most‑specific‑first chain, guarding with {@link DEFAULT_LANGUAGE}.
 */
export const resolveLanguage = (
  ...chain: ReadonlyArray<Lyric.LanguageTag | undefined>
): Lyric.LanguageTag => {
  for (const language of chain) {
    if (language) {
      return language
    }
  }
  return DEFAULT_LANGUAGE
}
