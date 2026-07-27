/**
 * 字体工具：枚举系统字体 + 应用软件字体到 :root。
 *
 * 枚举优先用 Local Font Access API（Electron 39 支持 window.queryLocalFonts），
 * 失败则回退到按 OS 的常见字体清单，保证下拉总有可选项。
 */

/** 各 OS 常见字体兜底清单（枚举失败时用） */
const FALLBACK_FONTS: Record<string, string[]> = {
  win32: [
    'Microsoft YaHei',
    'Microsoft YaHei UI',
    'SimSun',
    'SimHei',
    'KaiTi',
    'FangSong',
    'Segoe UI',
    'Arial',
    'Tahoma',
    'Consolas'
  ],
  darwin: [
    'PingFang SC',
    'Hiragino Sans GB',
    'STHeiti',
    'STSong',
    'Helvetica Neue',
    'Arial',
    'Menlo'
  ],
  linux: [
    'Source Han Sans SC',
    'Noto Sans CJK SC',
    'WenQuanYi Micro Hei',
    'Ubuntu',
    'DejaVu Sans',
    'Droid Sans'
  ]
}

/** 枚举系统已安装字体族名（去重排序）。失败回退常见清单。 */
export async function listSystemFonts(platform: string): Promise<string[]> {
  const q = (window as unknown as { queryLocalFonts?: () => Promise<{ family: string }[]> })
    .queryLocalFonts
  if (typeof q === 'function') {
    try {
      const fonts = await q()
      const families = Array.from(new Set(fonts.map((f) => f.family))).filter(Boolean)
      if (families.length) return families.sort((a, b) => a.localeCompare(b))
    } catch {
      /* 权限被拒或不支持，走兜底 */
    }
  }
  return FALLBACK_FONTS[platform] ?? FALLBACK_FONTS.win32
}

/**
 * 应用软件界面字体：写入 :root 的 --app-font（base.css 各 OS 字体栈以它为首选）。
 * 空字符串则清除，回退默认字体栈。
 */
export function applyAppFont(font: string): void {
  const root = document.documentElement
  if (font) root.style.setProperty('--app-font', `"${font}"`)
  else root.style.removeProperty('--app-font')
}
