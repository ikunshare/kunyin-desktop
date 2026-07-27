/**
 * Well-known language tags used across the kit.
 */
export enum LanguageType {
  /**
   * Simplified Chinese.
   */
  ChineseSimplified = 'zh-hans',
  /**
   * Traditional Chinese.
   */
  ChineseTraditional = 'zh-hant',
  /**
   * English.
   */
  English = 'en',
  /**
   * Japanese.
   */
  Japanese = 'ja',
  /**
   * Korean.
   */
  Korean = 'ko',
  /**
   * Russian.
   */
  Russian = 'ru',
  /**
   * French.
   */
  French = 'fr',
  /**
   * German.
   */
  German = 'de',
  /**
   * Spanish.
   */
  Spanish = 'es',
  /**
   * Italian.
   */
  Italian = 'it',
  /**
   * Portuguese.
   */
  Portuguese = 'pt'
}

/**
 * A language tag: a well-known LanguageType or any other tag string.
 */
export type LanguageTag = LanguageType | (string & {})
