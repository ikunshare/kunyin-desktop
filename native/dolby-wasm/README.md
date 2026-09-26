# dolby-wasm

LibreMPEG（FFmpeg 的分支，<https://github.com/librempeg/librempeg>）的杜比解码器编成的 wasm，
给主进程做杜比码流软解（Chromium 不带杜比解码器）：

| 解码器       | 用在哪                          | 喂法                        |
| ------------ | ------------------------------- | --------------------------- |
| `ac3`/`eac3` | QQ 杜比全景声（E-AC-3 JOC 5.1） | 任意切分的字节流，过 parser |
| `ac4`        | 网易杜比全景声（AC-4 IMS）      | 一次一个完整帧（MP4 样本）  |

用 LibreMPEG 而不用 FFmpeg，是因为只有它带 AC-4 解码器。AC-3 系两边同源，换过来之后
`tools/dolbyDecoder.test.mjs` 原样通过。提交钉的是 Zencok/mpv-libre-runtime 当时 Release 用的那个
（那边的 CI 验过 AC-4 解码）。

JS 封装在 `src/main/audio/dolbyDecoder.ts`，MP4 → WAV 的流在 `src/main/audio/dolbyStream.ts`，
回归在 `tools/dolbyDecoder.test.mjs` 与 `tools/dolbyStream.test.mjs`。

## 许可证

LibreMPEG 整体按 GPL-3.0-or-later 发布（AC-4 解码器文件头就是 GPLv3），`build.sh` 显式
`--enable-gpl --enable-version3`，让 configure 报出的许可证与实际一致。全文 `COPYING.GPLv3`
经 `electron-builder.yml` 的 `extraResources` 放进安装包的 `resources/licenses/LibreMPEG-GPL-3.0.txt`，
设置页「关于」（`views/settings/SettingAbout.vue`）有署名与源码地址。`shim.c` 是坤音自己的代码。

## 构建

```bash
npm run build:dolby-wasm
```

- 产物内联成 `src/main/audio/dolbyWasmBinary.ts`（base64，**提交进仓库**），`npm run build`
  和 CI 都不需要这套工具链。只有升级 LibreMPEG 或改了 `shim.c` 才要跑。
- configure / make 只能在类 Unix 环境跑：Linux / macOS 直接用 bash，Windows 走 WSL。
  源码包（GitHub 按提交打的 tar.gz）在宿主机下载并校验 sha256（WSL 里常常解析不了外网域名），
  缓存在 `.cache/`（已 gitignore）。
- 工具链是 [wasi-sdk](https://github.com/WebAssembly/wasi-sdk)（clang + wasi-libc），产出
  wasm32-wasip1 reactor。它导入的 14 个 WASI 系统调用在 JS 侧打桩：解码器用不到文件和环境变量。
- **avfilter 不能关**：LibreMPEG 让 libavcodec 依赖它（configure 里 `avcodec_deps="avfilter"`），
  关了 avcodec 会被整个禁用、只编出 libavutil。`--disable-everything` 下它不带任何滤镜。
- 编译产物约 870KB（AC-3 系约 500KB，AC-4 解码器多出约 370KB）。`-Oz` 下 AC-4 解码约 56× 实时，
  E-AC-3 约 540× 实时。

## 升级 LibreMPEG

改 `build.sh` 顶部的 `LIBREMPEG_COMMIT` 与 `scripts/build-dolby-wasm.mjs` 里的提交 / sha256，
跑 `npm run build:dolby-wasm` 与 `npm test`，把 `dolbyWasmBinary.ts` 一起提交。「关于」页里的
源码链接同步改掉。AC-4 没有开源编码器、仓库里没有真夹具，升级后要拿真实的网易杜比文件对照一次
LibreMPEG 原生 ffmpeg 的解码输出（做法见 `tools/dolbyStream.test.mjs` 文件头）。
