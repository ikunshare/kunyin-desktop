export const enum XmlNodeType {
  Element = 1,
  Text = 2,
  Cdata = 3,
  Comment = 4,
  Document = 5
}

export const enum CharCode {
  // <
  LessThan = 0x3c,
  // >
  GreaterThan = 0x3e,
  // /
  Slash = 0x2f,
  // =
  Equal = 0x3d,
  // "
  DoubleQuote = 0x22,
  // '
  SingleQuote = 0x27,
  // !
  Exclamation = 0x21,
  // -
  Dash = 0x2d,
  // ?
  QuestionMark = 0x3f,
  // &
  Ampersand = 0x26,
  // #
  Hash = 0x23,
  // x
  LowerX = 0x78
}

export const ROOT_TAG = '#document' as const
