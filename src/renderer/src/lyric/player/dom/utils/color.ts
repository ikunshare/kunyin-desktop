const HEX_REGEX = /^[0-9a-fA-F]{6}$/
const RGB_REGEX = /^rgba?\s*\(\s*([^)]+)\s*\)$/i

const clamp = (value: number): number => (value < 0 ? 0 : value > 255 ? 255 : value)

const parse = (raw: string): number | null => {
  const text = raw.trim()
  if (!text.length) {
    return null
  }

  // 14%
  if (text.endsWith('%')) {
    const percent = Number.parseFloat(text.slice(0, -1))
    if (!Number.isFinite(percent)) {
      return null
    }
    return clamp(Math.round(percent * 2.55))
  }

  const value = Number.parseFloat(text)
  if (!Number.isFinite(value)) {
    return null
  }

  return clamp(Math.round(value))
}

/**
 * Parse color string to rgb, Channels accept either percentages (`0%`–`100%`) or numeric (`0`–`255`) values.
 *
 * Returns `null` when the input doesn't match any supported syntax.
 *
 * @example `#rrggbb` or `#rgb`
 * @example `rgb(r, g, b)` or `rgba(r, g, b, a)`
 */
export const parseColor = (input: string): [number, number, number] | null => {
  if (typeof input !== 'string') return null
  const text = input.trim()
  if (text.length === 0) return null

  // hex
  // 0x23 char is '#'
  if (text.charCodeAt(0) === 0x23) {
    let hex = text.slice(1)
    if (hex.length === 3) {
      hex = hex
        .split('')
        .map((character) => character + character)
        .join('')
    }

    if (!HEX_REGEX.test(hex)) {
      return null
    }

    const r = Number.parseInt(hex.slice(0, 2), 16)
    const g = Number.parseInt(hex.slice(2, 4), 16)
    const b = Number.parseInt(hex.slice(4, 6), 16)

    return [r, g, b]
  }

  // rgb
  const result = RGB_REGEX.exec(text)
  if (result) {
    const parts = result[1].split(/[\s,/]+/).filter(Boolean)
    if (parts.length < 3) {
      return null
    }

    const r = parse(parts[0])
    const g = parse(parts[1])
    const b = parse(parts[2])
    if (r === null || g === null || b === null) {
      return null
    }

    return [r, g, b]
  }

  return null
}
