/** 数值钳制（AMLL core #utils/clamp.ts 精简移植） */

export function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x))
}

export function clampPositive(x: number): number {
  return Math.max(0, x)
}
