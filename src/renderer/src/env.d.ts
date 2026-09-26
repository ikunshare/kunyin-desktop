/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 构建期注入（electron.vite.config.ts 的 define），「关于」页显示用 */
  readonly VITE_VERSION: string
  readonly ELECTRON_VITE_VERSION: string
}
