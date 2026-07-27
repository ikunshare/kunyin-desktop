// 运行期主题注入。移植自 lx-music-desktop 的 setTheme/applyTheme 思路：
// 主题变量写入 <style> 的 :root 块；'auto' 时按系统深浅色在 light/dark 两主题间切换。
import {
  buildThemeColors,
  customToThemeDef,
  findTheme,
  THEMES,
  type CustomThemeConfig,
  type ThemeDef
} from './themes'

const STYLE_ID = 'theme-vars'

function setThemeVars(colors: Record<string, string>): void {
  let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null
  const body = Object.entries(colors)
    .map(([k, v]) => `${k}:${v};`)
    .join('')
  if (el) {
    // 幂等：内容没变就不重写 textContent。重写会让 --background-image 的 url()
    // 被移除再解析，背景图短暂消失再出现（启动时二次 applyTheme 会触发）。
    if (el.textContent === `:root{${body}}`) return
  } else {
    el = document.createElement('style')
    el.id = STYLE_ID
    document.head.appendChild(el)
  }
  el.textContent = `:root{${body}}`
}

const darkQuery = window.matchMedia('(prefers-color-scheme: dark)')

let currentId = 'green'
let currentLightId = 'green'
let currentDarkId = 'black'
let customThemes: ThemeDef[] = []

function resolve(id: string): ThemeDef {
  const themeId = id === 'auto' ? (darkQuery.matches ? currentDarkId : currentLightId) : id
  return (
    findTheme(themeId, customThemes) ??
    // 兜底：引用了不存在的主题（如已删除的自定义主题）时回落到默认深浅主题
    findTheme(darkQuery.matches ? 'black' : 'green', customThemes) ??
    THEMES[0]
  )
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

/** 同步用户自定义主题列表（settings.appearance.customThemes 变更时调用） */
export function setCustomThemes(configs: CustomThemeConfig[]): void {
  customThemes = configs.map(customToThemeDef)
}

// 系统深浅变化时，若处于 auto 则重新应用
darkQuery.addEventListener('change', () => {
  if (currentId === 'auto') applyTheme('auto')
})

/** 首屏初始化（同步注入默认主题变量，避免无样式闪烁） */
export function initTheme(id = 'green'): void {
  applyTheme(id)
}

/** 当前已解析主题的背景图 URL（无则 null）。
 * 启动流程在显示窗口前预载它，避免窗口可见后图片才解码弹入。 */
export function currentBackgroundImageUrl(): string | null {
  const v = resolve(currentId).ext['--background-image']
  if (!v || v === 'none') return null
  const m = /^url\((?:"|')?(.*?)(?:"|')?\)$/.exec(v.trim())
  return m?.[1] || null
}
