import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import vue from '@vitejs/plugin-vue'

// src/common 为主进程 / preload / 渲染层三端共享的类型与常量层
const commonAlias = { '@common': resolve('src/common') }

export default defineConfig({
  main: {
    resolve: { alias: commonAlias }
  },
  preload: {
    resolve: { alias: commonAlias }
  },
  renderer: {
    resolve: {
      alias: {
        ...commonAlias,
        '@renderer': resolve('src/renderer/src')
      }
    },
    build: {
      rollupOptions: {
        input: {
          // 主窗口 + 桌面歌词悬浮窗（第二个无边框透明窗口）
          index: resolve('src/renderer/index.html'),
          'desktop-lyrics': resolve('src/renderer/desktop-lyrics.html')
        }
      }
    },
    plugins: [vue()]
  }
})
