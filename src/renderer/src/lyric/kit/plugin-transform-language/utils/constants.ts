import { Lyric } from '../../lyric'

/**
 * Script categories the detector can recognize.
 */
export type Script = 'kana' | 'hangul' | 'han' | 'cyrillic' | 'latin'

/**
 * Inclusive Unicode code-point ranges for each script.
 */
export const SCRIPT_RANGES: Record<Script, [number, number][]> = {
  kana: [
    [0x3040, 0x30ff], // hiragana and katakana, including the prolonged sound mark
    [0x31f0, 0x31ff], // katakana phonetic extensions
    [0xff66, 0xff9f] // halfwidth katakana
  ],
  hangul: [
    [0x1100, 0x11ff], // hangul jamo
    [0x3130, 0x318f], // hangul compatibility jamo
    [0xa960, 0xa97f], // hangul jamo extended-a
    [0xac00, 0xd7a3], // hangul syllables
    [0xd7b0, 0xd7ff] // hangul jamo extended-b
  ],
  han: [
    [0x3005, 0x3007], // iteration marks and ideographic number zero
    [0x3400, 0x4dbf], // CJK extension A
    [0x4e00, 0x9fff], // CJK unified ideographs
    [0xf900, 0xfaff], // CJK compatibility ideographs
    [0x20000, 0x2ebef] // CJK extension B through F
  ],
  cyrillic: [
    [0x0400, 0x04ff], // cyrillic
    [0x0500, 0x052f] // cyrillic supplement
  ],
  latin: [
    [0x0041, 0x005a], // A-Z
    [0x0061, 0x007a], // a-z
    [0x00c0, 0x00d6], // latin-1 letters before the multiplication sign
    [0x00d8, 0x00f6], // latin-1 letters between the multiplication and division signs
    [0x00f8, 0x024f] // latin extended-a and extended-b
  ]
}

/**
 * Resolution order; higher-priority scripts win ties when a word mixes several.
 */
export const SCRIPT_PRIORITY: Script[] = ['kana', 'hangul', 'han', 'cyrillic', 'latin']

/**
 * Characters that only appear in simplified Chinese, paired index-wise with TRADITIONAL_CHARS.
 * Forms shared with traditional usage must never be listed, or they would bias the variant count.
 */
export const SIMPLIFIED_CHARS =
  '个们这来时国爱学龙价关当会实应体与东车马鸟鱼见贝页风飞长门问间阳阴队际难鸡欢观觉写让说话语读谁请谢边过还进远连万业习乡书买卖红级约经给续网罗义乐药园圆图团医动单样节总开闭闻员质贵费资购数转轻软输较尽层属张报担据击坚紧亲穷权伤胜师虽听乌响绣盐养钟众庄'

/**
 * Characters that only appear in traditional Chinese, paired index-wise with SIMPLIFIED_CHARS.
 */
export const TRADITIONAL_CHARS =
  '個們這來時國愛學龍價關當會實應體與東車馬鳥魚見貝頁風飛長門問間陽陰隊際難雞歡觀覺寫讓說話語讀誰請謝邊過還進遠連萬業習鄉書買賣紅級約經給續網羅義樂藥園圓圖團醫動單樣節總開閉聞員質貴費資購數轉輕軟輸較盡層屬張報擔據擊堅緊親窮權傷勝師雖聽烏響繡鹽養鐘眾莊'

/**
 * Simplified-only characters as a lookup set.
 */
export const SIMPLIFIED_SET = new Set(SIMPLIFIED_CHARS)

/**
 * Traditional-only characters as a lookup set.
 */
export const TRADITIONAL_SET = new Set(TRADITIONAL_CHARS)

/**
 * Per-character hints toward a specific Latin-script language, scored by how distinctive each character is.
 * Shared diacritics add to several languages at once; the highest total wins, English otherwise.
 */
export const LATIN_FEATURE_SCORES: Record<string, Partial<Record<Lyric.LanguageType, number>>> = {
  ß: { [Lyric.LanguageType.German]: 3 },
  ä: { [Lyric.LanguageType.German]: 2 },
  ö: { [Lyric.LanguageType.German]: 1 },
  ü: { [Lyric.LanguageType.German]: 1, [Lyric.LanguageType.Spanish]: 0.5 },
  ñ: { [Lyric.LanguageType.Spanish]: 3 },
  '¿': { [Lyric.LanguageType.Spanish]: 3 },
  '¡': { [Lyric.LanguageType.Spanish]: 3 },
  œ: { [Lyric.LanguageType.French]: 3 },
  æ: { [Lyric.LanguageType.French]: 3 },
  ç: { [Lyric.LanguageType.French]: 1.5, [Lyric.LanguageType.Portuguese]: 1 },
  ê: { [Lyric.LanguageType.French]: 1, [Lyric.LanguageType.Portuguese]: 1 },
  ë: { [Lyric.LanguageType.French]: 1 },
  î: { [Lyric.LanguageType.French]: 1 },
  ï: { [Lyric.LanguageType.French]: 1 },
  û: { [Lyric.LanguageType.French]: 1 },
  è: { [Lyric.LanguageType.French]: 1, [Lyric.LanguageType.Italian]: 1 },
  à: {
    [Lyric.LanguageType.French]: 0.5,
    [Lyric.LanguageType.Italian]: 1,
    [Lyric.LanguageType.Portuguese]: 0.5
  },
  â: { [Lyric.LanguageType.French]: 1, [Lyric.LanguageType.Portuguese]: 1 },
  ô: { [Lyric.LanguageType.French]: 0.5, [Lyric.LanguageType.Portuguese]: 1 },
  ù: { [Lyric.LanguageType.French]: 0.5, [Lyric.LanguageType.Italian]: 1 },
  ã: { [Lyric.LanguageType.Portuguese]: 3 },
  õ: { [Lyric.LanguageType.Portuguese]: 3 },
  ì: { [Lyric.LanguageType.Italian]: 2 },
  ò: { [Lyric.LanguageType.Italian]: 1.5 },
  á: { [Lyric.LanguageType.Spanish]: 1, [Lyric.LanguageType.Portuguese]: 1 },
  é: {
    [Lyric.LanguageType.French]: 0.5,
    [Lyric.LanguageType.Spanish]: 0.5,
    [Lyric.LanguageType.Portuguese]: 0.5,
    [Lyric.LanguageType.Italian]: 0.5
  },
  í: { [Lyric.LanguageType.Spanish]: 1, [Lyric.LanguageType.Italian]: 0.5 },
  ó: { [Lyric.LanguageType.Spanish]: 1, [Lyric.LanguageType.Portuguese]: 0.5 },
  ú: { [Lyric.LanguageType.Spanish]: 1 }
}

/**
 * Kana share of all kana plus han characters above which a document is treated as Japanese,
 * attributing its han characters to Japanese rather than Chinese.
 */
export const JAPANESE_KANA_RATIO = 0.05
