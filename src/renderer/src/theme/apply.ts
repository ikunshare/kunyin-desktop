// 运行期主题注入。移植自 lx-music-desktop 的 setTheme/applyTheme 思路。
import { buildThemeColors, findTheme, THEMES, type ThemeDef } from './themes'

const STYLE_ID = 'theme-vars'

function setThemeVars(colors: Record<string, string>): void {
  let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null
  if (!el) {
    el = document.createElement('style')
    el.id = STYLE_ID
    document.head.appendChild(el)
  }
  const body = Object.entries(colors)
    .map(([k, v]) => `${k}:${v};`)
    .join('')
  el.textContent = `:root{${body}}`
}

const darkQuery = window.matchMedia('(prefers-color-scheme: dark)')

let currentId = 'green'
let currentLightId = 'green'
let currentDarkId = 'midnight'

function resolve(id: string): ThemeDef {
  const themeId = id === 'auto' ? (darkQuery.matches ? currentDarkId : currentLightId) : id
  return findTheme(themeId) ?? THEMES[0]
}

/** 应用主题。id 可为具体主题 id 或 'auto'（跟随系统深浅）。 */
export function applyTheme(id: string, lightId = currentLightId, darkId = currentDarkId): void {
  currentId = id
  currentLightId = lightId
  currentDarkId = darkId
  const theme = resolve(id)
  setThemeVars(buildThemeColors(theme))
  document.documentElement.classList.toggle('theme-dark', theme.isDark)
}

// 系统深浅变化时，若处于 auto 则重新应用
darkQuery.addEventListener('change', () => {
  if (currentId === 'auto') applyTheme('auto')
})

/** 首屏初始化（同步注入默认主题变量，避免无样式闪烁） */
export function initTheme(id = 'green'): void {
  applyTheme(id)
}
