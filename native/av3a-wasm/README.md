# av3a-wasm

[MOLAN-AV3A](https://github.com/baiji6/MOLAN-AV3A)（AVS3-P3 / Audio Vivid 参考解码器 AVS3A_RMv3.3.1
的库化封装）编成的 wasm，给主进程软解网易「臻音全景声」：MP4 里的 av3a 音轨，实测 44.1kHz、
7.1.4 声床、832kbps、每样本 1024 帧。

- **喂法**：一次一个完整的 MP4 样本（= 一个 AV3A 帧）。`shim.c` 把上游的 C API 包成
  open / in_ptr / packet / out_ptr 几个导出，输出交错 s16 多声道。
- **下混在 JS 侧**（`src/main/audio/av3aDecoder.ts`）：参考解码器只吐声床各声道、自己不渲染，
  这里按帧头的声道配置混成立体声再交给 `dolbyStream.ts` 的 WAV 流。对象、声床 + 对象、HOA
  没有真实样本验证，明确报错不瞎混。
- **每路解码一个 `WebAssembly.Instance`**：参考解码器有模块级状态（包括下面说的 `rand()`），
  实例隔离最省心，丢掉实例整块回收。

回归在 `tools/av3aDecoder.test.mjs`（解码、声道次序、下混电平、坏帧）与 `tools/dolbyStream.test.mjs`
（MP4 → WAV、Range、seek 预热），夹具 `tools/fixtures/sine-7.1.4-av3a.mp4` 是参考编码器编的正弦，
生成方法见 `tools/fixtures/README.md`。

## 许可证

AVS3-P3 参考软件版权归华为，按 UWA（世界超高清视频产业联盟）的
[Code Sharing Policy](http://www.theuwa.com/UWA_Code_Sharing_Policy.pdf) 授权，不是 OSI 意义上的开源许可证；
MOLAN-AV3A 自己的封装代码按同一政策提供。`LICENSE` 与 `NOTICE` 由 `build.sh` 从上游源码包拷出，
经 `electron-builder.yml` 的 `extraResources` 放进安装包的 `resources/licenses/`，设置页「关于」
（`views/settings/SettingAbout.vue`）有署名与源码地址。`shim.c` 是坤音自己的代码。

## 构建

```bash
npm run build:av3a-wasm
```

- 产物内联成 `src/main/audio/av3aWasmBinary.ts`（base64，**提交进仓库**），`npm run build`
  和 CI 都不需要这套工具链。只有升级 MOLAN-AV3A 或改了 `shim.c` 才要跑。
- 编译在类 Unix 环境跑：Linux / macOS 直接用 bash，Windows 走 WSL。源码包与 wasi-sdk 在宿主机下载并校验
  sha256（WSL 里常常解析不了外网域名），缓存在 `.cache/`（已 gitignore）。wasi-sdk 与 dolby-wasm 同一个版本，
  `native/dolby-wasm/.cache` 里有就直接用。
- 源文件清单取上游 `CMakeLists.txt` 的 `MOLAN_AV3A_LIB_SOURCES`；`-DAVS3_NO_MAIN=1`、静音头、`-fsigned-char`
  与上游 CMake 一致。
- **栈开到 8MB**：参考解码器把整帧的多声道数组放在栈上，wasm-ld 默认的 64KB 第一帧就越界。
- 神经网络后处理模型由上游以 C 数组内嵌（`model.h`），不要外部文件。产物约 310KB，`-O2 -msimd128`
  下网易 7.1.4 约 28× 实时（不开 SIMD 约 20×，输出逐样本相同）。

## 已知差异：噪声填充的随机数

参考解码器的噪声填充（`noise_filling.c`）与带宽扩展（`bwe_dec.c`）调的是 libc 的 `rand()`：全局状态、
从不播种。所以：

- wasm（wasi-libc）与原生 Linux 版（glibc）的随机序列不同：网易文件整段对照 SNR 35dB；几乎不触发噪声填充的
  正弦夹具逐样本最大误差 6 LSB。
- seek 时新开的解码器从头取随机数，跟连续播放到那里的序列对不上，网易文件上差 31～41dB；`reset()`
  同样不让它归位。

差的都只是那一层噪声，不是解错了，别当 bug 追。

## 升级 MOLAN-AV3A

改 `build.sh` 顶部的 `MOLAN_COMMIT` 与 `scripts/build-av3a-wasm.mjs` 里的提交 / sha256，跑
`npm run build:av3a-wasm` 与 `npm test`，把 `av3aWasmBinary.ts`、`LICENSE`、`NOTICE` 一起提交；
「关于」页的源码链接同步改掉，再跑一次 `npm run gen:licenses`。另外拿一首真实的网易臻音全景声对照一次
原生 `molan-av3a decode` 的输出。
