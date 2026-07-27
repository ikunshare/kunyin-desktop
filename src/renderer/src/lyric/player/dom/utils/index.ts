export * from './color'

export * from './style'

export * from './frame'

export * from './sort'

export * from './language'

export const clamp = (value: number, min: number, max: number): number =>
  value < min ? min : value > max ? max : value

export const round = (value: number, count: number): number => {
  const factor = 10 ** count
  return Math.round(value * factor) / factor
}
