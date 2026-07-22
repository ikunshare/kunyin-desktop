// 主题定义与色阶生成。移植自 lx-music-desktop（Apache-2.0, © lyswhut）的
// src/common/theme/{utils.js, createThemes.js}，改写为 TS。
import { RGB_Alpha_Shade, RGB_Linear_Shade } from './colorUtils'

export type ThemeColors = Record<string, string>

export interface ThemeDef {
  id: string
  name: string
  isDark: boolean
  isDarkFont: boolean
  /** 品牌主色 rgb(...) */
  primary: string
  /** 正文字色 rgb(...) */
  font: string
  /** 语义变量覆盖（--color-app-background 等） */
  ext: ThemeColors
}

/** 由 primary/font 派生完整 --color-primary-* 与字色梯度 */
export function createThemeColors(
  rgbaColor: string,
  fontRgbaColor: string,
  isDark: boolean,
  isDarkFont: boolean
): ThemeColors {
  const colors: ThemeColors = { '--color-primary': rgbaColor }

  let preColor = rgbaColor
  for (let i = 1; i < 11; i += 1) {
    preColor = RGB_Linear_Shade(isDark ? 0.2 : -0.1, preColor)
    colors[`--color-primary-dark-${i * 100}`] = preColor
    for (let j = 1; j < 10; j += 1) {
      colors[`--color-primary-dark-${i * 100}-alpha-${j * 100}`] = RGB_Alpha_Shade(
        0.1 * j,
        preColor
      )
      colors[`--color-primary-alpha-${j * 100}`] = RGB_Alpha_Shade(0.1 * j, rgbaColor)
    }
  }
  preColor = rgbaColor
  for (let i = 1; i < 10; i += 1) {
    preColor = RGB_Linear_Shade(isDark ? -0.1 : 0.2, preColor)
    colors[`--color-primary-light-${i * 100}`] = preColor
    for (let j = 1; j < 10; j += 1) {
      colors[`--color-primary-light-${i * 100}-alpha-${j * 100}`] = RGB_Alpha_Shade(
        0.1 * j,
        preColor
      )
    }
  }
  preColor = RGB_Linear_Shade(isDark ? -0.35 : 1, preColor)
  colors['--color-primary-light-1000'] = preColor
  for (let j = 1; j < 10; j += 1) {
    colors[`--color-primary-light-1000-alpha-${j * 100}`] = RGB_Alpha_Shade(0.1 * j, preColor)
  }

  colors['--color-theme'] = isDark ? colors['--color-primary-light-900'] : rgbaColor

  return { ...colors, ...createFontColors(fontRgbaColor, isDark, isDarkFont) }
}

function createFontColors(rgbaColor: string, isDark: boolean, isDarkFont: boolean): ThemeColors {
  rgbaColor ||= isDark ? 'rgb(229, 229, 229)' : 'rgb(33, 33, 33)'
  if (isDark) {
    const colors: ThemeColors = { '--color-1000': rgbaColor }
    const step = isDarkFont ? -0.015 : -0.05
    let preColor = rgbaColor
    for (let i = 1; i < 21; i += 1) {
      preColor = RGB_Linear_Shade(step, preColor)
      colors[`--color-${String(1000 - 50 * i).padStart(3, '0')}`] = preColor
    }
    return colors
  }
  const colors: ThemeColors = { '--color-1000': rgbaColor }
  const step = isDarkFont ? 0.02 : 0.05
  for (let i = 1; i < 21; i += 1) {
    colors[`--color-${String(1000 - 50 * i).padStart(3, '0')}`] = RGB_Linear_Shade(
      step * i,
      rgbaColor
    )
  }
  return colors
}

// 浅色语义覆盖模板（各浅色主题共用）
const lightExt = (badgeSecondary: string, badgeTertiary: string): ThemeColors => ({
  '--color-app-background': 'var(--color-primary-light-600-alpha-700)',
  '--color-main-background': 'rgba(255, 255, 255, 1)',
  // 侧栏图标用中性字色（非主色），避免浅底上主色低透明度发虚；激活态由背景+主色描示
  '--color-nav-font': 'var(--color-font)',
  '--color-badge-primary': 'var(--color-primary)',
  '--color-badge-secondary': badgeSecondary,
  '--color-badge-tertiary': badgeTertiary
})

/** 内置主题（移植自 lx-music-desktop 默认主题；深色主题 midnight 为坤音补充） */
export const THEMES: ThemeDef[] = [
  {
    id: 'green',
    name: '绿意盎然',
    isDark: false,
    isDarkFont: false,
    primary: 'rgb(77, 175, 124)',
    font: 'rgb(33, 33, 33)',
    ext: lightExt('#4baed5', '#e7aa36')
  },
  {
    id: 'blue',
    name: '蓝田生玉',
    isDark: false,
    isDarkFont: false,
    primary: 'rgb(52, 152, 219)',
    font: 'rgb(33, 33, 33)',
    ext: lightExt('#5cbf9b', '#5cbf9b')
  },
  {
    id: 'orange',
    name: '橙黄橘绿',
    isDark: false,
    isDarkFont: false,
    primary: 'rgb(245, 171, 53)',
    font: 'rgb(33, 33, 33)',
    ext: lightExt('#9ed458', '#9ed458')
  },
  {
    id: 'red',
    name: '热情似火',
    isDark: false,
    isDarkFont: false,
    primary: 'rgb(214, 69, 65)',
    font: 'rgb(33, 33, 33)',
    ext: lightExt('#dfbb6b', '#dfbb6b')
  },
  {
    id: 'midnight',
    name: '午夜',
    isDark: true,
    isDarkFont: false,
    primary: 'rgb(96, 165, 250)',
    font: 'rgb(229, 229, 229)',
    ext: {
      '--color-app-background': 'rgb(18, 18, 20)',
      '--color-main-background': 'rgb(26, 27, 30)',
      '--color-content-background': 'rgb(30, 31, 35)',
      '--color-nav-font': 'var(--color-font)',
      '--color-primary-background': 'var(--color-primary-alpha-800)',
      '--color-primary-background-hover': 'var(--color-primary-alpha-700)',
      '--color-primary-background-active': 'var(--color-primary-alpha-600)',
      '--color-button-background': 'var(--color-primary-alpha-800)',
      '--color-button-background-hover': 'var(--color-primary-alpha-700)',
      '--color-button-background-active': 'var(--color-primary-alpha-600)',
      '--color-badge-primary': 'var(--color-primary)',
      '--color-badge-secondary': '#4baed5',
      '--color-badge-tertiary': '#e7aa36'
    }
  }
]

/** 组装某主题的完整 CSS 变量（派生梯度 + 语义覆盖） */
export function buildThemeColors(theme: ThemeDef): ThemeColors {
  return {
    ...createThemeColors(theme.primary, theme.font, theme.isDark, theme.isDarkFont),
    ...theme.ext
  }
}

export function findTheme(id: string): ThemeDef | undefined {
  return THEMES.find((t) => t.id === id)
}
