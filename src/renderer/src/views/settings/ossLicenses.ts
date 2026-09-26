/**
 * 自动生成，请勿手改。
 *
 * 「设置 → 关于坤音」的开源许可列表：进了安装包的代码，外加内嵌 / 移植的上游项目。
 * 许可证链接生成时逐个在线核实过；核实不了的不显示，名字记在 OSS_EXCLUDED。
 * 重新生成：npm run gen:licenses（见 scripts/gen-licenses.mjs）
 */

export interface OssProject {
  name: string
  /** 项目主页 */
  url: string
  /** SPDX 许可证表达式 */
  license: string
  /** 在线许可证全文 */
  licenseUrl: string
  /** 坤音拿它做什么（手工登记的才有） */
  usage?: string
  /** 进包的 npm 包名（与 name 相同时省略） */
  packages?: string[]
  /** 经由别的依赖间接引用 */
  indirect?: boolean
}

export interface OssSection {
  title: string
  items: OssProject[]
}

export const OSS_SECTIONS: OssSection[] = [
  {
    title: '运行环境',
    items: [
      {
        name: 'Electron',
        url: 'https://www.electronjs.org/',
        usage: '应用运行时',
        license: 'MIT',
        licenseUrl: 'https://github.com/electron/electron/blob/main/LICENSE'
      },
      {
        name: 'Chromium',
        url: 'https://www.chromium.org/',
        license: 'BSD-3-Clause',
        usage: 'Electron 内核：界面渲染与音频播放',
        indirect: true,
        licenseUrl: 'https://chromium.googlesource.com/chromium/src/+/main/LICENSE'
      },
      {
        name: 'V8',
        url: 'https://v8.dev/',
        license: 'BSD-3-Clause',
        usage: 'Electron 内置的 JavaScript 引擎',
        indirect: true,
        licenseUrl: 'https://chromium.googlesource.com/v8/v8/+/main/LICENSE'
      },
      {
        name: 'Node.js',
        url: 'https://nodejs.org/',
        license: 'MIT',
        usage: 'Electron 内置，主进程运行时',
        indirect: true,
        licenseUrl: 'https://github.com/nodejs/node/blob/main/LICENSE'
      },
      {
        name: 'FFmpeg',
        url: 'https://ffmpeg.org/',
        license: 'LGPL-2.1-or-later',
        usage: 'Chromium 内置的音频解码',
        indirect: true,
        licenseUrl: 'https://github.com/FFmpeg/FFmpeg/blob/master/LICENSE.md'
      }
    ]
  },
  {
    title: '内嵌与移植的代码',
    items: [
      {
        name: 'music-lyric-kit',
        usage: '歌词解析（内嵌源码）',
        url: 'https://github.com/music-lyric/music-lyric-kit-node',
        license: 'MIT',
        licenseUrl: 'https://github.com/music-lyric/music-lyric-kit-node/blob/main/LICENSE'
      },
      {
        name: 'music-lyric-player',
        usage: '歌词渲染（内嵌源码）',
        url: 'https://github.com/music-lyric/music-lyric-player-web',
        license: 'MIT',
        licenseUrl: 'https://github.com/music-lyric/music-lyric-player-web/blob/main/LICENSE'
      },
      {
        name: 'Apple Music-like Lyrics',
        usage: '播放页的流体渐变背景（内嵌 bg-render）',
        url: 'https://github.com/amll-dev/applemusic-like-lyrics',
        license: 'AGPL-3.0',
        licenseUrl: 'https://github.com/amll-dev/applemusic-like-lyrics/blob/main/LICENSE'
      },
      {
        name: 'LX Music 桌面版',
        usage: '设置页布局、音效与混响脉冲响应、下载歌词、榜单与歌单接口等（移植）',
        url: 'https://github.com/lyswhut/lx-music-desktop',
        license: 'Apache-2.0',
        licenseUrl: 'https://github.com/lyswhut/lx-music-desktop/blob/master/LICENSE'
      },
      {
        name: 'phaze',
        usage: '升降调的 phase vocoder（内嵌）',
        url: 'https://github.com/olvb/phaze',
        license: 'Unlicense',
        licenseUrl: 'https://github.com/olvb/phaze/blob/master/LICENSE'
      },
      {
        name: 'LibreMPEG',
        license: 'GPL-3.0-or-later',
        usage: '杜比软解：AC-3 / E-AC-3 / AC-4 解码器（编译进 wasm）',
        url: 'https://github.com/librempeg/librempeg',
        licenseUrl:
          'https://github.com/librempeg/librempeg/blob/9c00336e26e45ed1274c9693382b1b1441ccaf6a/COPYING.GPLv3'
      },
      {
        name: 'wasi-libc',
        license: 'Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT',
        usage: '杜比解码 wasm 静态链接的 C 库',
        url: 'https://github.com/WebAssembly/wasi-libc',
        licenseUrl: 'https://github.com/WebAssembly/wasi-libc/blob/main/LICENSE'
      },
      {
        name: 'Rust',
        url: 'https://www.rust-lang.org/',
        license: 'MIT OR Apache-2.0',
        usage: 'QMC 解密 wasm 链接的 core 库',
        licenseUrl: 'https://github.com/rust-lang/rust/blob/main/LICENSE-MIT'
      },
      {
        name: 'netease-report-listen-song',
        usage: '网易云听歌上报：NCBL 封包（移植）',
        url: 'https://github.com/folltoshe/netease-report-listen-song',
        license: 'AGPL-3.0',
        licenseUrl: 'https://github.com/folltoshe/netease-report-listen-song/blob/main/LICENSE'
      }
    ]
  },
  {
    title: 'npm 依赖',
    items: [
      {
        name: '@borewit/text-codec',
        url: 'https://github.com/Borewit/text-codec',
        license: 'MIT',
        licenseUrl: 'https://github.com/Borewit/text-codec/blob/master/LICENSE.txt',
        indirect: true
      },
      {
        name: '@bufbuild/protobuf',
        url: 'https://github.com/bufbuild/protobuf-es',
        license: 'Apache-2.0 AND BSD-3-Clause',
        licenseUrl: 'https://github.com/bufbuild/protobuf-es/blob/main/LICENSE',
        indirect: true
      },
      {
        name: '@tokenizer/inflate',
        url: 'https://github.com/Borewit/tokenizer-inflate',
        license: 'MIT',
        licenseUrl: 'https://github.com/Borewit/tokenizer-inflate/blob/main/LICENSE',
        indirect: true
      },
      {
        name: '@vitejs/plugin-vue',
        url: 'https://github.com/vitejs/vite-plugin-vue',
        license: 'MIT',
        licenseUrl: 'https://github.com/vitejs/vite-plugin-vue/blob/main/LICENSE'
      },
      {
        name: 'argparse',
        url: 'https://github.com/nodeca/argparse',
        license: 'Python-2.0',
        licenseUrl: 'https://github.com/nodeca/argparse/blob/master/LICENSE',
        indirect: true
      },
      {
        name: 'better-sqlite3',
        url: 'https://github.com/WiseLibs/better-sqlite3',
        license: 'MIT',
        licenseUrl: 'https://github.com/WiseLibs/better-sqlite3/blob/master/LICENSE'
      },
      {
        name: 'content-type',
        url: 'https://github.com/jshttp/content-type',
        license: 'MIT',
        licenseUrl: 'https://github.com/jshttp/content-type/blob/master/LICENSE',
        indirect: true
      },
      {
        name: 'debug',
        url: 'https://github.com/debug-js/debug',
        license: 'MIT',
        licenseUrl: 'https://github.com/debug-js/debug/blob/master/LICENSE',
        indirect: true
      },
      {
        name: 'dijkstrajs',
        url: 'https://github.com/tcort/dijkstrajs',
        license: 'MIT',
        licenseUrl: 'https://github.com/tcort/dijkstrajs/blob/master/LICENSE.md',
        indirect: true
      },
      {
        name: 'Electron Toolkit',
        url: 'https://github.com/alex8088/electron-toolkit',
        license: 'MIT',
        licenseUrl: 'https://github.com/alex8088/electron-toolkit/blob/master/LICENSE',
        packages: ['@electron-toolkit/preload', '@electron-toolkit/utils']
      },
      {
        name: 'electron-builder',
        url: 'https://github.com/electron-userland/electron-builder',
        license: 'MIT',
        licenseUrl: 'https://github.com/electron-userland/electron-builder/blob/master/LICENSE',
        packages: ['builder-util-runtime', 'electron-updater']
      },
      {
        name: 'file-type',
        url: 'https://github.com/sindresorhus/file-type',
        license: 'MIT',
        licenseUrl: 'https://github.com/sindresorhus/file-type/blob/main/license',
        indirect: true
      },
      {
        name: 'fs-extra',
        url: 'https://github.com/jprichardson/node-fs-extra',
        license: 'MIT',
        licenseUrl: 'https://github.com/jprichardson/node-fs-extra/blob/master/LICENSE',
        indirect: true
      },
      {
        name: 'gl-matrix',
        url: 'https://github.com/toji/gl-matrix',
        license: 'MIT',
        licenseUrl: 'https://github.com/toji/gl-matrix/blob/master/LICENSE.md'
      },
      {
        name: 'graceful-fs',
        url: 'https://github.com/isaacs/node-graceful-fs',
        license: 'ISC',
        licenseUrl: 'https://github.com/isaacs/node-graceful-fs/blob/main/LICENSE.md',
        indirect: true
      },
      {
        name: 'iconv-lite',
        url: 'https://github.com/pillarjs/iconv-lite',
        license: 'MIT',
        licenseUrl: 'https://github.com/pillarjs/iconv-lite/blob/master/LICENSE'
      },
      {
        name: 'ieee754',
        url: 'https://github.com/feross/ieee754',
        license: 'BSD-3-Clause',
        licenseUrl: 'https://github.com/feross/ieee754/blob/master/LICENSE',
        indirect: true
      },
      {
        name: 'js-yaml',
        url: 'https://github.com/nodeca/js-yaml',
        license: 'MIT',
        licenseUrl: 'https://github.com/nodeca/js-yaml/blob/master/LICENSE',
        indirect: true
      },
      {
        name: 'jsonfile',
        url: 'https://github.com/jprichardson/node-jsonfile',
        license: 'MIT',
        licenseUrl: 'https://github.com/jprichardson/node-jsonfile/blob/master/LICENSE',
        indirect: true
      },
      {
        name: 'Lodash',
        url: 'https://github.com/lodash/lodash',
        license: 'MIT',
        licenseUrl: 'https://github.com/lodash/lodash/blob/main/LICENSE',
        packages: ['lodash-es', 'lodash.escaperegexp', 'lodash.isequal']
      },
      {
        name: 'media-typer',
        url: 'https://github.com/jshttp/media-typer',
        license: 'MIT',
        licenseUrl: 'https://github.com/jshttp/media-typer/blob/master/LICENSE',
        indirect: true
      },
      {
        name: 'ms',
        url: 'https://github.com/vercel/ms',
        license: 'MIT',
        licenseUrl: 'https://github.com/vercel/ms/blob/main/LICENSE',
        indirect: true
      },
      {
        name: 'music-lyric-model',
        url: 'https://github.com/music-lyric/music-lyric-model-node',
        license: 'MIT',
        licenseUrl: 'https://github.com/music-lyric/music-lyric-model-node/blob/main/LICENSE'
      },
      {
        name: 'music-metadata',
        url: 'https://github.com/Borewit/music-metadata',
        license: 'MIT',
        licenseUrl: 'https://github.com/Borewit/music-metadata/blob/master/LICENSE.txt'
      },
      {
        name: 'node-addon-api',
        url: 'https://github.com/nodejs/node-addon-api',
        license: 'MIT',
        licenseUrl: 'https://github.com/nodejs/node-addon-api/blob/main/LICENSE.md',
        indirect: true
      },
      {
        name: 'opencc-js',
        url: 'https://github.com/nk2028/opencc-js',
        license: 'MIT AND Apache-2.0',
        licenseUrl: 'https://github.com/nk2028/opencc-js/blob/main/LICENSE'
      },
      {
        name: 'pinia',
        url: 'https://github.com/vuejs/pinia',
        license: 'MIT',
        licenseUrl: 'https://github.com/vuejs/pinia/blob/v4/LICENSE'
      },
      {
        name: 'qrcode',
        url: 'https://github.com/soldair/node-qrcode',
        license: 'MIT',
        licenseUrl: 'https://github.com/soldair/node-qrcode/blob/master/license'
      },
      {
        name: 'safer-buffer',
        url: 'https://github.com/ChALkeR/safer-buffer',
        license: 'MIT',
        licenseUrl: 'https://github.com/ChALkeR/safer-buffer/blob/master/LICENSE',
        indirect: true
      },
      {
        name: 'sax',
        url: 'https://github.com/isaacs/sax-js',
        license: 'BlueOak-1.0.0',
        licenseUrl: 'https://github.com/isaacs/sax-js/blob/main/LICENSE.md',
        indirect: true
      },
      {
        name: 'semver',
        url: 'https://github.com/npm/node-semver',
        license: 'ISC',
        licenseUrl: 'https://github.com/npm/node-semver/blob/main/LICENSE'
      },
      {
        name: 'strtok3',
        url: 'https://github.com/Borewit/strtok3',
        license: 'MIT',
        licenseUrl: 'https://github.com/Borewit/strtok3/blob/master/LICENSE.txt',
        indirect: true
      },
      {
        name: 'tiny-typed-emitter',
        url: 'https://github.com/binier/tiny-typed-emitter',
        license: 'MIT',
        licenseUrl: 'https://github.com/binier/tiny-typed-emitter/blob/master/LICENSE',
        indirect: true
      },
      {
        name: 'token-types',
        url: 'https://github.com/Borewit/token-types',
        license: 'MIT',
        licenseUrl: 'https://github.com/Borewit/token-types/blob/master/LICENSE.txt',
        indirect: true
      },
      {
        name: 'uint8array-extras',
        url: 'https://github.com/sindresorhus/uint8array-extras',
        license: 'MIT',
        licenseUrl: 'https://github.com/sindresorhus/uint8array-extras/blob/main/license',
        indirect: true
      },
      {
        name: 'universalify',
        url: 'https://github.com/RyanZim/universalify',
        license: 'MIT',
        licenseUrl: 'https://github.com/RyanZim/universalify/blob/master/LICENSE',
        indirect: true
      },
      {
        name: 'Vite',
        url: 'https://github.com/vitejs/vite',
        license: 'MIT',
        licenseUrl: 'https://github.com/vitejs/vite/blob/main/LICENSE'
      },
      {
        name: 'Vue',
        url: 'https://github.com/vuejs/core',
        license: 'MIT',
        licenseUrl: 'https://github.com/vuejs/core/blob/main/LICENSE',
        packages: ['@vue/reactivity', '@vue/runtime-core', '@vue/runtime-dom', '@vue/shared', 'vue']
      },
      {
        name: 'vue-router',
        url: 'https://github.com/vuejs/router',
        license: 'MIT',
        licenseUrl: 'https://github.com/vuejs/router/blob/main/LICENSE'
      },
      {
        name: 'win-guid',
        url: 'https://github.com/Borewit/win-guid',
        license: 'MIT',
        licenseUrl: 'https://github.com/Borewit/win-guid/blob/master/LICENSE.txt',
        indirect: true
      },
      {
        name: 'ws',
        url: 'https://github.com/websockets/ws',
        license: 'MIT',
        licenseUrl: 'https://github.com/websockets/ws/blob/master/LICENSE'
      }
    ]
  }
]

/** 查不到在线许可证、因此不显示的项目 / npm 包 */
export const OSS_EXCLUDED: string[] = ['@tokenizer/token', 'fft.js', 'lazy-val']
