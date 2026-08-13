// 主题定义与色阶生成。移植自 lx-music-desktop（Apache-2.0, © lyswhut）的
// src/common/theme/{index.json, utils.js, createThemes.js}，改写为 TS。
// 色阶（--color-primary-dark-*/light-*、字色 --color-000~1000）由 createThemeColors
// 从主色/字色派生，与 LX 的 index.json 展开结果一致；ext 对应其 extInfo 语义覆盖。
import { RGB_Alpha_Shade, RGB_Linear_Shade } from './colorUtils'
import type { CustomThemeConfig } from '@common'
import bgLandingMoon from '../assets/theme/landingMoon.png'
import bgJqbg from '../assets/theme/jqbg.jpg'
import bgMyzc from '../assets/theme/myzcbg.jpg'
import bgChinaInk from '../assets/theme/china_ink.jpg'
import bgXnkl from '../assets/theme/xnkl.png'

export type { CustomThemeConfig }

export type ThemeColors = Record<string, string>

export interface ThemeDef {
  id: string
  name: string
  isDark: boolean
  isDarkFont: boolean
  /** 是否用户自定义主题 */
  isCustom?: boolean
  /** 品牌主色 rgb(...) */
  primary: string
  /** 正文字色 rgb(...) */
  font: string
  /** 语义变量覆盖（--color-app-background / --background-image 等） */
  ext: ThemeColors
}

/** 用户自定义主题配置（存于 settings.appearance.customThemes，跨进程传输的纯数据） */

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

// ---- extInfo 模板（对应 LX index.json 各主题的 extInfo） ----

/** 无背景图浅色主题共用模板 */
const lightExt = (badgeSecondary: string, badgeTertiary: string): ThemeColors => ({
  '--color-app-background': 'var(--color-primary-light-600-alpha-700)',
  '--color-main-background': 'rgba(255, 255, 255, 1)',
  '--color-nav-font': 'var(--color-primary)',
  '--background-image': 'none',
  '--color-badge-primary': 'var(--color-primary)',
  '--color-badge-secondary': badgeSecondary,
  '--color-badge-tertiary': badgeTertiary
})

/** 带背景图浅色主题模板（app/main 背景半透明，透出 #app 层的背景图） */
const lightBgExt = (
  image: string,
  appBg: string,
  mainBg: string,
  badgeSecondary: string,
  badgeTertiary: string,
  extra?: ThemeColors
): ThemeColors => ({
  '--color-app-background': appBg,
  '--color-main-background': mainBg,
  '--color-nav-font': 'var(--color-primary)',
  '--background-image': `url(${image})`,
  '--color-badge-primary': 'var(--color-primary)',
  '--color-badge-secondary': badgeSecondary,
  '--color-badge-tertiary': badgeTertiary,
  ...extra
})

/** 内置主题（完整移植自 lx-music-desktop 的 15 个默认主题） */
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
    id: 'blue_plus',
    name: '蛋雅深蓝',
    isDark: false,
    isDarkFont: false,
    primary: 'rgb(77, 131, 175)',
    font: 'rgb(33, 33, 33)',
    ext: {
      ...lightExt('rgba(66.6, 150.7, 171, 1)', 'rgba(54, 196, 231, 1)'),
      '--color-app-background': 'var(--color-primary-light-600-alpha-600)'
    }
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
    id: 'pink',
    name: '粉装玉琢',
    isDark: false,
    isDarkFont: false,
    primary: 'rgb(241, 130, 141)',
    font: 'rgb(33, 33, 33)',
    ext: lightExt('#f5b684', '#f5b684')
  },
  {
    id: 'purple',
    name: '重斤球紫',
    isDark: false,
    isDarkFont: false,
    primary: 'rgb(155, 89, 182)',
    font: 'rgb(33, 33, 33)',
    ext: lightExt('#e5a39f', '#e5a39f')
  },
  {
    id: 'grey',
    name: '灰常美丽',
    isDark: false,
    isDarkFont: false,
    primary: 'rgb(108, 122, 137)',
    font: 'rgb(33, 33, 33)',
    ext: lightExt('#b19b9f', '#b19b9f')
  },
  {
    id: 'ming',
    name: '青出于黑',
    isDark: false,
    isDarkFont: false,
    primary: 'rgb(51, 110, 123)',
    font: 'rgb(33, 33, 33)',
    ext: lightExt('#6376a2', '#6376a2')
  },
  {
    id: 'blue2',
    name: '清热板蓝',
    isDark: false,
    isDarkFont: false,
    primary: 'rgb(79, 98, 208)',
    font: 'rgb(33, 33, 33)',
    ext: lightExt('#b080db', '#b080db')
  },
  {
    id: 'black',
    name: '黑灯瞎火',
    isDark: true,
    isDarkFont: false,
    primary: 'rgb(150, 150, 150)',
    font: 'rgb(229, 229, 229)',
    ext: {
      '--color-app-background': 'rgba(0, 0, 0, 0)',
      '--color-main-background': 'rgba(19, 19, 19, 0.9)',
      '--color-nav-font': 'var(--color-primary)',
      '--background-image': `url(${bgLandingMoon})`,
      '--color-badge-primary': 'var(--color-primary-dark-200)',
      '--color-badge-secondary': 'var(--color-primary)',
      '--color-badge-tertiary': 'var(--color-primary-dark-300)'
    }
  },
  {
    id: 'mid_autumn',
    name: '月里嫦娥',
    isDark: false,
    isDarkFont: false,
    primary: 'rgb(74, 55, 82)',
    font: 'rgb(33, 33, 33)',
    ext: lightBgExt(
      bgJqbg,
      'rgba(255, 255, 255, 0)',
      'rgba(255, 255, 255, 0.76)',
      '#af9479',
      '#af9479',
      { '--color-nav-font': 'var(--color-primary-light-600)' }
    )
  },
  {
    id: 'naruto',
    name: '木叶之村',
    isDark: false,
    isDarkFont: false,
    primary: 'rgb(87, 144, 167)',
    font: 'rgb(33, 33, 33)',
    ext: lightBgExt(
      bgMyzc,
      'rgba(255, 255, 255, 0.08)',
      'rgba(255, 255, 255, 0.7)',
      'var(--color-primary-light-100)',
      'var(--color-primary-light-100)'
    )
  },
  {
    id: 'china_ink',
    name: '近墨者黑',
    isDark: false,
    isDarkFont: false,
    primary: 'rgba(47, 47, 47, 1)',
    font: 'rgb(33, 33, 33)',
    ext: lightBgExt(
      bgChinaInk,
      'rgba(255, 255, 255, 0)',
      'rgba(255, 255, 255, 0.8)',
      'rgba(67, 139, 65, 1)',
      'rgba(132, 135, 65, 1)',
      {
        '--color-badge-primary': 'rgba(137, 70, 70, 1)',
        '--color-btn-hide': 'rgba(183, 212, 208, 1)',
        '--color-btn-min': 'rgba(200, 214, 183, 1)',
        '--color-btn-close': 'rgba(218, 195, 188, 1)'
      }
    )
  },
  {
    id: 'happy_new_year',
    name: '新年快乐',
    isDark: false,
    isDarkFont: false,
    primary: 'rgb(192, 57, 43)',
    font: 'rgb(33, 33, 33)',
    ext: lightBgExt(
      bgXnkl,
      'rgba(255, 255, 255, 0.15)',
      'rgba(255, 255, 255, 0.8)',
      '#dfbb6b',
      'var(--color-primary-light-100)',
      { '--color-badge-primary': '#7fb575' }
    )
  }
]

/** 组装某主题的完整 CSS 变量（派生梯度 + 语义覆盖） */
export function buildThemeColors(theme: ThemeDef): ThemeColors {
  return {
    ...createThemeColors(theme.primary, theme.font, theme.isDark, theme.isDarkFont),
    ...theme.ext
  }
}

/** 自定义主题配置 → 主题定义（背景图绝对路径转 file:/// URL，其余走浅色/深色默认模板） */
export function customToThemeDef(config: CustomThemeConfig): ThemeDef {
  const bgImage = config.bgImage
    ? `url(file:///${encodeURI(config.bgImage.replaceAll('\\', '/'))})`
    : 'none'
  const ext: ThemeColors = config.isDark
    ? {
        '--color-app-background': 'rgba(0, 0, 0, 0)',
        '--color-main-background': 'rgba(19, 19, 19, 0.9)',
        '--color-nav-font': 'var(--color-primary)',
        '--background-image': bgImage,
        '--color-badge-primary': 'var(--color-primary)',
        '--color-badge-secondary': '#4baed5',
        '--color-badge-tertiary': '#e7aa36'
      }
    : {
        ...lightExt('#4baed5', '#e7aa36'),
        // 有背景图时主区半透明透出背景
        ...(config.bgImage
          ? {
              '--color-app-background': 'rgba(255, 255, 255, 0.15)',
              '--color-main-background': 'rgba(255, 255, 255, 0.85)'
            }
          : {}),
        '--background-image': bgImage
      }
  if (config.appBackground) ext['--color-app-background'] = config.appBackground
  if (config.contentBackground) ext['--color-main-background'] = config.contentBackground
  if (config.sidebarButton) ext['--color-nav-font'] = config.sidebarButton
  if (config.badgePrimary) ext['--color-badge-primary'] = config.badgePrimary
  if (config.badgeSecondary) ext['--color-badge-secondary'] = config.badgeSecondary
  if (config.badgeTertiary) ext['--color-badge-tertiary'] = config.badgeTertiary
  if (config.buttonClose) ext['--color-btn-close'] = config.buttonClose
  if (config.buttonMin) ext['--color-btn-min'] = config.buttonMin
  if (config.buttonHide) ext['--color-btn-hide'] = config.buttonHide
  return {
    id: config.id,
    name: config.name,
    isDark: config.isDark,
    isDarkFont: config.isDarkFont ?? false,
    isCustom: true,
    primary: config.primary,
    font: config.font,
    ext
  }
}

export function findTheme(id: string, customs: ThemeDef[] = []): ThemeDef | undefined {
  return THEMES.find((t) => t.id === id) ?? customs.find((t) => t.id === id)
}
