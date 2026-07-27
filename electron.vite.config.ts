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
        '@renderer': resolve('src/renderer/src'),
        // 歌词解析器/播放器已 vendor 进 src/renderer/src/lyric（见 tools/vendor-lyric.mjs）。
        // 保留原包名做别名：业务侧 import 不必改，将来换回 npm 包也只动这里。
        'music-lyric-kit': resolve('src/renderer/src/lyric/kit/main'),
        'music-lyric-player': resolve('src/renderer/src/lyric/player/main')
      }
    },
    css: {
      modules: {
        // vendored 歌词引擎的 scss 用 kebab-case 类名（.space-end），TS 侧按 camelCase 取
        // （styles.spaceEnd）——上游靠这项自动转换。不配的话取到 undefined，
        // 元素拿不到类名：词间空格全部消失、annotation-row 的样式也整个失效。
        localsConvention: 'camelCaseOnly'
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
