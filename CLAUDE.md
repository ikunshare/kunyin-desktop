# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概览

坤音（KunYin）桌面端：Electron + Vue 3 + TypeScript 的多音源聚合音乐播放器，是 Android 版坤音（Kotlin/Compose，`com.ikunshare.sound`）的桌面重写。聚合六大在线音源（`wy` 网易云 / `qq` / `qqc` / `kg` 酷狗 / `kw` 酷我 / `joox`），提供统一搜索、播放、歌单、下载、歌词、平台登录、LX 同步体验。代码纯 AI 生成。

构建链：electron-vite（开发/构建）+ electron-builder（打包），包管理器 npm。

## 常用命令

```bash
npm install          # 装依赖（postinstall 会 electron-builder install-app-deps 重建原生模块）
npm run dev          # 开发调试（electron-vite dev，热更）
npm run build        # 构建 main/preload/renderer 到 out/
npm run start        # 预览已构建产物（electron-vite preview）

npm run typecheck    # = typecheck:node（tsc）+ typecheck:web（vue-tsc）
npm run lint         # eslint --cache .
npm run format       # prettier --write .
npm test             # node --test tools/*.test.mjs（带 ts-resolve 钩子，可直接 import 仓库 .ts）
npm run build:wasm   # 重编 native/qmc-wasm 并回写 src/main/crypto/qmcWasmBinary.ts（需 Rust）
npm run gen:licenses # 重新生成「关于」页的开源许可列表（要联网，gh 已登录或设 GITHUB_TOKEN）

npm run build:unpack # 构建 + 解包目录（不产安装包）
npm run build:win    # 构建 + Windows 安装包
npm run build:mac    # macOS
npm run build:linux  # Linux
```

- 单跑一侧类型检查用 `npm run typecheck:node` / `typecheck:web`。
- 构建产物在 `out/`，打包产物在 `dist/`。electron-builder 的瘦身 `files` 排除规则在 `electron-builder.yml`，**必须全部留在顶层**，win/mac/linux 段内不能再写 `files` 字段（否则顶层整份被静默忽略，见文件内注释）。

## 三层结构与共享层

Electron 三进程，源码分三棵 + 一个共享层：

- **src/main**（主进程）：唯一触网、触盘、跑加密/解密、SQLite 的地方。含 providers、crypto、store、cache、net、auth、modules、ipc、audio、windows。
- **src/preload**：contextBridge 暴露 `window.api`（类型化 `WindowApi`）、`window.electron`（@electron-toolkit/preload）、`__INITIAL_APPEARANCE__`。渲染层**不直接触网**，一切经 `window.api.<域>.<方法>` 转发到主进程。
- **src/renderer/src**（渲染层）：Vue 3 + Pinia + vue-router，两个入口 `index.html`（主窗口）+ `desktop-lyrics.html`（桌面歌词悬浮窗）。
- **src/common**：三端共享的类型/常量/纯函数，统一从 `@common` 导入（出口是 `src/common/index.ts`）。

路径别名（`electron.vite.config.ts` 与两个 tsconfig 的 `paths` 同步维护）：

- `@common` → `src/common`（三端通用）
- `@renderer` → `src/renderer/src`（仅渲染层）
- `music-lyric-kit` → `src/renderer/src/lyric/kit/main`、`music-lyric-player` → `src/renderer/src/lyric/player/main`（vendored 歌词引擎，业务侧 import 名不变）

## 核心数据模型（@common）

- `MusicItem`：按 `type`（`MusicSource`）分发的**可辨识联合**。公共字段在 `BaseMusicItem`，各源有专属字段（qq 有 `mid`，kg 有 `hash` 等）。`local` 只出现在歌单里、不走 Provider/后端。
- 唯一键 `getMusicItemKey(item)`：一般 `type_id`，酷狗 `kg_hash`（无 hash 的歌词重定向目标用 `kg_lyric_<downloadId>`）。列表去重、歌词缓存都靠它。
- 音质 `QualityId`（`128k|320k|flac|hires|atmos_plus|atmos|master|dolby|vivid`）：**唯一排序真源是 `QUALITY_IDS`**（低→高，`src/common/constants.ts`），徽标/降级/取流/下载顺序全从它派生。AI 音质的屏蔽与降级见 `blockedQualityIds` / `qualityFallbackOrder` / `qualityUpgradeOrder`。
  - **显示名按平台走 `qualityName(id, source)`**，别读 `Quality.name`（存量歌单里是改名前的叫法）。各平台叫法在 `SOURCE_QUALITY_NAMES`，取自 Android 版，但网易的沉浸环绕声（`sk`/sky）与高清臻音（`je`/jyeffect）Android 标反了、母带用的是旧名「鲸云母带」（现为超清母带），以后端实测为准。
  - `atmos_plus` = 网易高清臻音，**只认网易**（`SOURCE_ONLY_QUALITIES`）：它以前还装过已下线的 QQ「臻品全景声 2.0」/ 酷我 20501，存量歌单里还有。所以 `blockedQualityIds` / `playbackBlockedQualityIds` 落到具体歌上时**要传 `item.type`**。
  - `dolby` / `vivid`（AV3A）**只能下载**：Chromium 解不了，播放侧用 `playbackBlockedQualityIds` 跳过。例外是 `softDecoder(id, source)` 登记的平台：网易（AC-4）与 QQ / QQ音乐云（E-AC-3）的杜比都由主进程软解后能播（见「杜比软解」）；Audio Vivid 还没有解码器。它们排在母带之上只是为了降级时掉不进去，所以列表徽标一律不显示它们（否则会盖掉母带 / HiRes）。
- `Lyric`：主进程产出的原始歌词容器（`lrc/trans/roma/char/chroma/phonetic`），渲染层再交给 vendored 歌词引擎解析。

## Provider 架构（音源）

`src/main/providers/` 是音源抽象层：

- `base.ts` 的 `BaseProvider` 抽象类定义全接口（search / 专辑歌手 / 歌单 / MV / getLyric / resolveMediaInfo / 评论等），各源在 `providers/<source>/` 实现，默认方法返回空结果。
- `index.ts` 的 `registry` 注册六大源，`getProvider(source)` 按源取实例；登录态由 `src/main/auth/credentials.ts` 启动时读 cookie 注入 `provider.credentials`。

**移植铁律**：音源实现是 Android Kotlin/C++ 的**逐字移植**，禁止凭记忆或网络试错（签名/加密/设备指纹风控极敏感）。改某源前先读 Android 版坤音（<https://github.com/ikunshare/kunyin>）对应 Kotlin 源。非显然坑已散落在 `src/main/providers/` 与 `src/main/crypto/` 的注释里，例如：QQ 搜索必须走签名 `musics.fcg`（不是 `musicu.fcg`）；QRC 是改版 DES（`crypto/qqDes.ts`）；移植 C 位运算加密务必逐处 `>>>0` 保证 uint32 回绕（否则 mflac 解密输出=输入）。

### 听歌上报

两家各一条旁路，渲染层统一由 `composables/useListenReport.ts` 触发（真实播放墙钟计时，拖动不虚增），主进程失败一律静默，绝不影响播放：

- QQ：`providers/qq/report.ts`，三段上报（听歌记录 / 最近播放 / imusic_tj 播放流水），逐字移植 Android。
- 网易云：`providers/wy/report.ts`，走 PC 客户端**埋点**通道而非公开 API——一条 `_plv`（开播）+ 一条 `_pld`（本段播放秒数，听歌记录吃这条），封成 NCBL（`crypto/ncbl.ts`：ChaCha20 + 裸 RSA 包裹记录密钥 + zstd，回归在 `tools/ncbl.test.mjs`）后 multipart 传给 clientlog3。移植自 <https://github.com/folltoshe/netease-report-listen-song>（`src/desktop`）。登录态与设备指纹要**同时**出现在 cookie 与 NCBL 元信息块且两处一致；客户端版本 `3.1.35.205293` 与 `_addrefer` 里的构建号 `c9156c3`、页面 spm 路径是成套的抓包值，别只改其中一个。zstd 用的是 `node:zlib`（Node ≥ 22.15）。

## 播放地址解析与音频流（关键链路）

播放/下载共用的统一解析入口是 `src/main/providers/getUrl.ts` 的 `resolveMediaInfo(item, qualityId)`：

1. 本地歌曲直接短路；
2. 命中 `urlCache` 直接返回；
3. Provider 自定义 `resolveMediaInfo` 优先，否则回退自建后端 `POST https://c.wwwweb.top/app/getUrl`（body `{platform, musicId, quality, authst}`；`platform` 用 `BACKEND_PLATFORM` 映射，`musicId` 按源取 mid/hash/id，`authst` 来自卡密）；
4. 结果按直链时效缓存（切回听过的歌不重复请求）。

返回 `{url, ekey}`：**无 ekey = 明文直链**，渲染层 `<audio>` 直连（CSP `media-src` 放行 http/https）；**有 ekey = 加密流**（QQ mflac 等），走自定义协议 `kunyin://`（`src/main/audio/protocol.ts`，`protocol.handle` 边下边解密、透传 Range、支持 seek）。卡密校验在 `src/main/auth/manager.ts`（`POST /app/checkAuth`，校验通过即把卡密当 `authst` 用）。

### 取流连接的生命周期（socket 泄漏 =「放久了每首歌都超时」）

`kunyin://` 每一路取流都握着一个 Chromium socket，而**每主机只有 6 个、全进程 256 个**。漏掉的连接不会自己回来；攒满之后新的取流连额度都申请不到（请求在连接池里静默排队），而我们的「等响应头」计时器照样在走——表现就是**「放久了之后任何歌曲都 upstream header timeout，重启应用才恢复」**。下面三条都是实测结论，动这条链路前务必先读：

- **`protocol.handle` 的 `request.signal` 从不触发**（Electron 44 实测：换 `<audio>.src`、seek、渲染层 `AbortController` 全试过，一次都不 abort）。能观测到下游放弃的唯一信号是「我们返回的 `Response.body` 被 cancel」——即便 handler 是事后才返回的，Electron 也会补这一刀。所以取消靠 `bindToRequest` 里 pipeTo 落地反推；等响应头那段还没有 body 可 cancel，由 `openSlot` 的「同 token、且一个字节都没吐过的旧请求直接顶替」兜住。
- **`resp.body.cancel()` 不归还 socket**，只有 abort 那次 fetch 的 `AbortController` 才会（三种收尾方式对照实测：什么都不做 / body.cancel / abort，只有最后一种让活连接归零）。所以上游连接按**租约**管理（`UpstreamLease`，控制器**活过响应头阶段**），`net/request.ts` 的 `drainResponse` 同样是先 abort 再 cancel。
- **异步生成器取消不掉卡在 `await` 里的自己**：`AsyncGenerator.return()` 排在未决的 `next()` 之后，`fetchAndStore` 卡在 `await reader.read()`（上游半开）时 `finally` 永远跑不到，那条连接就永久泄漏。所以 `streamFrom` 的 cancel 必须**先 abort 再** `return()`，且所有上游流都要穿过 `audio/streamGuard.ts` 的空闲看门狗（`UPSTREAM_IDLE_TIMEOUT`，20s 一个字节都没有就掐断）。看门狗用 `highWaterMark: 0` 是**语义不是调优**：HWM=1 会让流自己预读一块，于是暂停播放时也始终挂着一次 pull，健康连接会被误判成停摆。

连续 3 次「等响应头超时」且此刻没有任何一路在正常供流时，`afterHeaderTimeout` 会清 DNS 并 `closeAllConnections()`（60s 冷却）——把用户原本只能靠「重启应用」解决的那件事自动化；判据已经保证没有可打断的播放。诊断入口 `audioNetStats()`（导出日志时自动记一条）：堆着一批 `bytes: 0` 的条目就是在漏连接。回归用例在 `tools/audioStream.test.mjs`。

### QMC 解密的 wasm 后端

QMC2（mflac/mgg）的两条**逐字节热循环**在 Rust 里：`native/qmc-wasm/src/lib.rs`（`#![no_std]`、无分配器、无 import，编译产物 ~2.6KB）。ekey 的 base64+TEA 解密每首歌只跑一次，仍留在 `src/main/crypto/mflac.ts` 用 TS 做。

- **产物是提交进仓库的**：`npm run build:wasm` 把 `.wasm` 转成 base64 内联进 `src/main/crypto/qmcWasmBinary.ts`（自动生成，别手改）。所以 `npm run build` 和 CI 三平台都**不需要 Rust**；只有改了 `lib.rs` 才要装 Rust 跑一次并把产物一起提交。内联而不是发资源文件，是为了绕开 asar 路径 / electron-builder `files` 规则 / 开发与打包两套 `__dirname` 那一堆坑。
- **两条实现必须逐字节一致**：`mflac.ts` 的 `MapCipher`/`Rc4Cipher` 退为回退实现兼对照基准，wasm 拿不到时自动降级（`createCipher`）。`tools/qmc.test.mjs` 跨实现比对 2000+ 组用例，并钉死了 4 组输出摘要——**摘要挂了说明两边被一起改坏了，不要改期望值**。启动日志有一条「QMC 解密后端：wasm / 纯 JS」，排查解密变慢先看它。
- 移植坑（`lib.rs` 注释里有对应说明）：`rc4_segment_key` 是**浮点**除法，换整数除法结果就变了；它的结果在 JS 侧分别经历 `% n` 与 `& 0x1ff`（ToInt32 截断），Rust 侧要按同样顺序复现；`rc4_hash` 是 uint32 乘法回绕（`wrapping_mul`）。
- 解密器状态是 wasm 的模块级 static，所以**每个解密器一个 `WebAssembly.Instance`**（单实例线性内存 192KB，实例化约 30µs），并发的播放流与下载任务不会互相踩。

### 杜比软解（AC-3 / E-AC-3 / AC-4 → WAV）

Chromium 不带杜比解码器，`native/dolby-wasm` 把 **LibreMPEG**（FFmpeg 的分支，只有它有 AC-4 解码器）的
ac3/eac3/ac4 解码器 + `shim.c` 编成 wasm，JS 封装是 `src/main/audio/dolbyDecoder.ts`。两家的杜比是两种东西：

- **网易：AC-4 IMS**（immersive stereo，256kbps）。Dolby 在编码端就做好了两声道的耳机双耳渲染，
  解出来就是空间效果——用户 A/B 过，要的就是这个。按包喂（一个 MP4 样本 = 一帧），**第一个 I 帧之前不出声**。
- **QQ：E-AC-3 JOC 5.1**（448kbps，`D0M1*.mmp4` 需 QMC 解密）。JOC 对象 / 高度信息 LibreMPEG 与 FFmpeg
  都不解，只能解出 5.1 床声道，再由解码器按码流系数（`stereo`）下混，听感接近普通立体声，而且下混后只有
  ~-25 LUFS，比普通 FLAC 低 15dB 左右。按字节流喂，过 ac3 parser。

播放链路：`PLAYER_STREAM` 按 `softDecoder()` 给流打上 `decode: 'dolby'`，`kunyin://` 转去 `serveDolby`
（`audio/protocol.ts`）。两家实测都是 faststart 的 MP4。`audio/mp4.ts` 从 moov 解出样本表（含 `stss`
I 帧表，按样本描述分辨 ac-3/ec-3/ac-4），`audio/dolbyStream.ts` 把 `<audio>` 的 Range 换算成
PCM 帧 → MP4 样本 → 原文件偏移，只回源那一段，解成**立体声 float32 WAV** 吐出去——
WAV 的字节与时间是线性的，seek 就是普通的 Range（Electron 44 实测正常，且不会去探文件尾）。
音效图、频谱、倍速、媒体会话全都照常挂在 `<audio>` 上，不另起播放器。

- **Content-Length 必须兑现**：WAV 长度由样本表算死，解码器少吐的在尾部补静音、多吐的截掉；
  AC-4 更进一步**逐包对齐**（坏帧 / 等 I 帧期间补静音），否则一次解坏后面整体错位。上游真出错要照常报错，
  不能拿静音顶替。
- **seek 要往前多解几帧再扔掉**（`warmupStart`）：AC-3 系退 1 帧（MDCT 重叠，冷启动那帧误差 ~0.1；预热后
  仍有 ~1e-3 差异，是解码器给零尾数加的随机抖动，多预热也不收敛，**别当 bug 追**）。AC-4 退到目标之前
  **至少 2 帧**处最近的 I 帧：从 I 帧起解第 1 帧误差 0.3、第 2 帧 5e-2，第 3 帧起逐样本一致。
- **取字节只走 `plainBytesOpener`**：它和直通路径一样缓存感知（缓存里存的是解密后的原 MP4，不是 WAV），
  且每次打开挂一个**子闸**——游标跳读时 cancel 旧流只能掐这一段，掐整路的 slot 会把后面的回源一起杀掉。
  faststart 首播时读 moov 和读音频是同一条连接，别在中间重开。
- 只出立体声：音效图里的压缩器 / 声像节点本来就把声道数夹到 2，多声道原样送出也到不了扬声器。
- 构建：LibreMPEG 让 **avcodec 依赖 avfilter**（`avcodec_deps="avfilter"`），`--disable-avfilter` 会让
  avcodec 整个消失、只编出 libavutil。整体按 GPLv3+（`--enable-gpl --enable-version3`，与实际一致），
  许可证全文经 `extraResources` 随包分发，「关于」页有署名与源码地址。许可证问题用户已明确不管。
- 产物同样内联成 TS（`dolbyWasmBinary.ts`，~870KB，提交进仓库），但写成**字符串数组 + `join`**：
  用 `'…' +` 串接是几千层深的表达式树，Node 的 TS 类型剥离会栈溢出。
- 重编 `npm run build:dolby-wasm`：Windows 走 WSL，源码包在宿主机下载校验（WSL 常常没 DNS）。
  回归在 `tools/dolbyDecoder.test.mjs`（AC-3 系解码器）与 `tools/dolbyStream.test.mjs`（MP4 → WAV、Range、
  取消，以及 AC-4 的 I 帧 / 预热 / 坏帧对齐）。**AC-4 没有开源编码器、做不出夹具**，测试里现场拼 MP4 +
  假解码器；升级 LibreMPEG 后要拿真实网易文件对照一次原生 ffmpeg 的输出。

## 音效（EQ / 混响 / 3D 环绕 / 升降调 / 最大声道输出）

处理图在 `src/renderer/src/audio/soundEffect.ts`（**渲染层**，不是主进程），结构逐条移植自
lx-music-desktop：`<audio> → source → analyser → 10 段 EQ →（变调 worklet）→ 干声/混响两路 →
压缩器 → panner → gain → destination`。频点、Q、预设曲线、各脉冲响应的干湿增益都在
`@common/audio`，是照抄上游调出来的听感，别凭感觉改。

界面跟 LX 一样挂在**播放页**而不是设置页——这些都是边听边调的项：
`components/SoundEffectDialog.vue`（均衡器 / 环境混响 / 3D 环绕 / 升降调，原生 `<dialog>`）与
`components/PlaybackRatePopover.vue`（播放速度 0.5×–2×＋保持音调，深色玻璃弹层），
入口是 `views/PlayerView.vue` 底部 `.actions` 里的两个按钮。只有「最大声道输出」这种
一次性开关留在设置页的**播放设置**（LX 也在那儿）。

三条硬约束，动它之前必须知道：

- **懒建图**：`createMediaElementSource` 一旦建立就撤不回来，此后 `<audio>` 的声音只能经
  AudioContext 出去。所以只有用户真开了某项音效才建图（`needsGraph()`）；全默认值时播放链路
  与没有这个功能时完全一致——否则自动播放策略会把它卡成静音（AudioContext 拿到用户手势前是
  suspended，那时声音只能走图就哑了）。
- **频谱有两条来源**：没建图走 `stores/player.ts` 的 `captureStream` 旁路，建了图改用图里的
  analyser。两者不能并存：建图后 capture 到的是静音，还会白挂一堆摘不掉的 sink。
- **输出设备**：建图后 sinkId 必须设到 `AudioContext` 上，设在 `<audio>` 上不起作用。LX 界面里
  那句「音效设置与自定义音频输出设备冲突，目前此问题暂无法解决」就是没绕过这点；
  `AudioContext.setSinkId` 在**安全上下文**下可用（Electron 44 实测：`file://` 有，`data:` 没有），
  渲染层正好满足，所以设备切换统一收口到 `soundEffect.ts` 的 `setSinkId()`。

滑杆的 `@input` 只试听、`@change` 才写设置——设置每写一次就是一次 JSON 原子写，按住滑杆拖会写
成百上千次。音效走 `previewSoundEffect`（直接改处理图），播放速度走 `stores/player.ts` 的
`previewPlaybackRate`（直接改 `<audio>.playbackRate`；`<audio>` 元素不出 store）。

## IPC 契约

- channel 常量全在 `src/common/types/ipc.ts` 的 `IpcChannels`，类型面是 `WindowApi`。
- 主进程 `src/main/ipc/handlers/` 按域拆分（app/window/settings/search/player/comment/auth/library/discover/download/account/redirect/shell/log），`index.ts` 统一 `registerIpc()`；`helpers.ts` 提供 `handle()`（带 try/catch + 日志）与 `sendToRenderer` / `sendToAllRenderers`。
- preload 里每个方法映射到对应 channel；**传 `MusicItem` 过 IPC 前必须先 `toPlain`**（Pinia 响应式 Proxy 无法被 structuredClone，会抛 DataCloneError）。preload 已统一处理，主进程 handler 之间再转发时同样要注意。

## 网络层（src/main/net）

音源接口的**唯一**出口。`request.ts` 是 Electron 绑定（`net.fetch` / `net.request`），
`policy.ts` 是纯逻辑（per-host 闸、重试退避、并发合并），刻意不 import electron
所以能被 `node --test` 直接跑（`tools/net.test.mjs`）。

用 `requestJson` / `requestText` / `requestBuffer`（发请求+读 body，全程受超时约束），
流式消费才用 `requestRaw`。每个请求受三重约束：

- **per-host 排队**（`HostGate`，默认 4）：Chromium 每 host 只有 6 个 socket，超发的请求在
  连接池里静默排队，而这段等待算在我们的 timeout 里（表现成「大歌单随机丢封面」），还会挤掉
  播放取流的额度。所以**别绕过这一层直接用 `net.fetch`** 打接口（取流除外，它有自己的路径）。
  正因有这个闸，`qq/cover.ts` 那种 `Promise.all` 扇出才是安全的。
- **超时覆盖读 body**：`timeout` 是**整个请求的绝对预算**（含各次重试与退避），不是每段各给一次。
  只掐「等响应头」的话，上游半开连接会让 `resp.text()` 永久 pending，调用方的 catch 永远不执行。
- **重试**：仅幂等方法（`isIdempotent`）+ 可重试状态码（429/5xx），指数退避 + 满抖动，
  服务端给了 `Retry-After` 就听它的。POST 一律只发一次（`qq/report.ts` 的上报重放会重复计数）。

其他约定：

- 错误类型 `RequestTimeoutError` / `RequestAbortedError` 区分「超时」与「调用方取消」，
  取消是预期路径（不写 error 日志、不重试）。可取消的请求传 `signal`。
- **相同 GET 并发合并**（无 cookie、无 signal、幂等时自动）。带 signal 的不合并：共享
  Promise 时任一方取消会把 AbortError 抛给没取消的等待者。要每次真打用 `noCoalesce: true`。
- `providers/discovery.ts` 的 `retry()` 与这里是两层：net 层管传输失败（带退避），
  discovery 管语义失败（HTTP 200 但 `errcode != 0`）。两层相乘但总耗时不变（预算是绝对的）。
- `requestRawWithHeaders` 走 `net.request` 只为读 `set-cookie`（`net.fetch` 会过滤掉它）；
  不重试。它内部所有出口都收口到一个 `settled` 闸——`req.abort()` 触发的是 `'abort'` 事件而非
  `'error'`，**只监听后者会让 Promise 在超时后永久挂住**（改之前就是这样，网易云 eapi 的
  登录/cookie 路径会静默卡死）。这条走 Electron，进不了 `node --test`，只有代码注释兜着，
  动它时务必保持每条出口都经过 `finish()`。
- **不打算读 body 的响应一律 `drainResponse(resp)`**：`requestRaw` 把「读 body」留给调用方，只看 `resp.ok` 就走人会留下一条挂死的连接（埋点上报、LAN 探活、失败后换链接重试都踩过），每播一首歌漏一条，最后连取流都没额度。注意它是 **abort 那次 fetch**，不是 `body.cancel()`——后者在 Electron 上不归还 socket（见上面取流那节）。
- 排查接口变慢：`netStats()` 给出各 host 的在飞/排队数，导出日志（LOG_DUMP）时会自动记一条；取流不走这一层，另看 `audioNetStats()`。
- 代理见 `proxy.ts`：`setProxy` 是全局的，应用前先 TCP 探活，不可达就回落直连（否则
  「接口通、播放全挂」极难排查）。

## 存储与缓存

- **SQLite**：`src/main/store/db.ts`（better-sqlite3 同步 API），schema v7，四张表 `songs/playlists/playlist_songs/song_redirects`，1:1 移植 Android `MusicDatabase.kt`。系统歌单是 `is_system=1` 的行（`trial`=试听列表兼「最近播放」、`favorites`=我的收藏），启动 seed。数据方法面在 `src/main/store/library.ts`（对应 `LocalMusicStore.kt`，含 `*Direct` 无副作用变体供同步/备份用）。
- **设置**：`src/main/store/settings.ts`，JSON 原子写，不走 SQLite。
- **缓存**：`src/main/cache/`（audioCache 分块磁盘缓存 / lyricCache / urlCache / lruStore）。
- 数据目录：启动时 `initAppDataDir()`（`src/main/core/paths.ts`）把数据迁到 `userData/data/`，与 Chromium 数据分离。用户数据默认在 `%APPDATA%/kunyin-desktop`（Win）、`~/Library/Application Support/kunyin-desktop`（macOS）、`~/.config/kunyin-desktop`（Linux）。

## 常驻模块

`src/main/modules/index.ts` 的 `registerModules()` 启动时挂载：devtools（Ctrl+F12）、media（全局媒体键/托盘/开机自启）、sync（LX Music 同步客户端）、backup（备份/导入）、updater（electron-updater）、desktop-lyrics（桌面歌词悬浮窗）、playlist-refresh（远程歌单自动刷新）、shortcuts（全局快捷键）、power（播放时阻止系统休眠 + 任务栏播放进度）。模块间用 `src/main/core/events.ts` 的类型化事件总线 `appEvent` 解耦（`app-inited` / `main-window-created` / `settings-updated`）。

## 渲染层与 UI 方向

- 路由（`src/renderer/src/router/index.ts`，hash 模式）：`MainLayout` 外壳子路由（search/discover/charts/playlists/download/settings + 详情页 playlist/album/artist/local），`/player` 是**全屏顶层路由**（覆盖外壳）。启动恢复上次页面（localStorage `kunyin:lastRoute`，播放页不记）。
- 状态用 Pinia（`src/renderer/src/stores/`：player/search/library/settings/download/artist/mv）。
- **UI 方向（用户已定）**：全屏播放器页 = Apple Music 招牌（封面取色流体渐变 `FluidBackground` + 逐字歌词 + 白色前景）；其余页面 = LX Music 风（绿意浅色，单主色派生换肤引擎 `src/renderer/src/theme/`，运行期注入 CSS 变量）。**不要自创中性色板或「AI 味」设计**，列表/设置/详情用 LX 语义变量（`--color-primary-background(-hover/-active)`、`--color-font(-label)`、`--color-button-*`）。

## 设置页分类

`views/settings/index.vue` 的 `tocList` 就是分类与顺序的唯一真源，**按 lx-music-desktop 的设置页对齐**：基本设置 → 播放设置 → 播放详情页设置 → 桌面歌词设置 → 列表设置 → 下载设置 → 快捷键设置 → 数据同步 → 网络设置 → 备份与恢复 → 其他 →（开发者）→ 软件更新 → 关于。括号里那项是坤音自己加的。

跟着 LX 的几条归属约定，新增设置项时照此放：

- 歌词**内容**开关（显示翻译/音译）在**播放设置**；歌词**呈现**（字体等）在**播放详情页设置**。
- 「不喜欢的歌曲」规则在**其他**，不在播放设置。
- 列表相关独立成**列表设置**，不并进基本设置。
- 边听边调的项（音效、播放速度）**不进设置页**，放到播放页的弹层里（见上面「音效」一节）。
- LX 有而坤音没有对应设置项的分类（搜索设置、开放 API、强迫症设置）**不建空页**。

### 「关于坤音」的开源许可列表

`views/settings/ossLicenses.ts` 是 `scripts/gen-licenses.mjs` 生成的（提交进仓库，别手改）。收录范围是
**真正进了安装包的代码**：主进程按 lockfile 顺着 `dependencies` 走（**不走 peer**——electron 是
@electron-toolkit/utils 的 peer，它的下载器依赖不进 app.asar）；渲染层以带 sourcemap 的构建产物为准
（按依赖树算会把 vue 的 compiler-sfc 那一串都算进来）；Electron 内核、内嵌 / 移植代码、编进 wasm 的库在脚本的
`RUNTIME` / `EMBEDDED` 里手工登记。

**用户定的规矩：查不到在线 LICENSE 的项目不显示**（「那是这个项目的事」）。脚本逐个在线核实，核实不了的只记进
`OSS_EXCLUDED`（目前是 fft.js、lazy-val、@tokenizer/token，它们的仓库里确实没有许可证文件）。装 / 删依赖或新增
内嵌代码后重跑并提交产物；`tools/ossLicenses.test.mjs` 会拦住忘了重跑的情况。技术栈版本里 Vite / electron-vite
只在构建期存在，经 `electron.vite.config.ts` 的 `define` 以 `import.meta.env.*` 注入。

## Vendored 第三方代码

- 音效资源 vendored 在 `src/renderer/src/audio/`：`filters/*.wav`（13 条混响脉冲响应，来自 lx-music-desktop）与 `pitch-shifter.worklet.js`（olvb/phaze 的 phase vocoder）。后者是把上游三个文件拼成的单文件——AudioWorklet 在 Chromium 里不支持静态 `import`，而 Vite 的 `?url` 只拷贝不打包依赖。出处与改动登记在 `src/renderer/src/audio/README.md`，eslint/prettier 已忽略该 worklet。
- 歌词引擎 vendored 在 `src/renderer/src/lyric/`（music-lyric-kit 解析 + music-lyric-player 渲染，纯 DOM、零框架依赖）。**上游没有倍速概念**：引擎自走一条 `performance.now()` 墙钟、逐字擦除又是 WAAPI 墙钟动画，倍速播放时两者都得乘上速率，否则歌词越放越落后。速率由 `stores/player.ts` 的 `playbackRate`（跟着 `<audio>` 的真值，含滑杆试听）经 `useLyricPlayer().setPlaybackRate()` 下发，桌面歌词走 `DesktopLyricState.playbackRate`；「这是 seek 不是自然推进」的重对齐阈值同样要按速率放大，否则 2× 下每帧都被当成 seek。改动登记在 lyric/README.md，背景在 `src/renderer/src/bg-render/`（AMLL MeshGradient，WebGL + gl-matrix）。eslint 已忽略 `lyric/**`、对 `bg-render` 关显式返回类型；对这些目录的改动须标 `[vendor patch]` 并登记 `src/renderer/src/lyric/README.md`，保持与上游可对照。别名让业务侧 import 名不变，将来换回 npm 包只动 `electron.vite.config.ts` 与 tsconfig。

## 发布与自动更新

- 版本号在 `package.json`，**不带 `v` 前缀**。打 `vX.Y.Z` 标签（须与 version 严格一致）并 push → `.github/workflows/release.yml` 自动建 Release 并在 Windows/macOS/Linux 三平台构建 + 上传安装包与 `latest*.yml`。
- **打包产物名必须是 ASCII**：`productName` 是中文「坤音」，而各 target 的默认 `artifactName` 模板大多含 `${productName}`。产物本身上传时会按模板改名，但**它的 blockmap 用的是磁盘文件名**，electron-publish 拼上传 URL 时不转义就抛 `Request path contains unescaped characters`，整个平台任务挂掉、后续的 `latest*.yml` 也传不上去（= 该平台自动更新失效）。mac/dmg/nsis/appImage 都已显式覆盖 `artifactName`；**新加 target 时照做**。
- 用户端自动更新走 electron-updater（GitHub Releases provider，`electron-builder.yml` 的 `publish`），设置页「软件更新」（`views/settings/SettingUpdate.vue`）手动检查，启动静默检查。
