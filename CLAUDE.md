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
npm test             # node --test tools/*.test.mjs

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
- 音质 `QualityId`（`128k|320k|flac|hires|master|atmos|atmos_plus`）：**唯一排序真源是 `QUALITY_IDS`**（低→高，`src/common/constants.ts`），徽标/降级/取流/下载顺序全从它派生。AI 音质的屏蔽与降级见 `blockedQualityIds` / `qualityFallbackOrder` / `qualityUpgradeOrder`。
- `Lyric`：主进程产出的原始歌词容器（`lrc/trans/roma/char/chroma/phonetic`），渲染层再交给 vendored 歌词引擎解析。

## Provider 架构（音源）

`src/main/providers/` 是音源抽象层：

- `base.ts` 的 `BaseProvider` 抽象类定义全接口（search / 专辑歌手 / 歌单 / MV / getLyric / resolveMediaInfo / 评论等），各源在 `providers/<source>/` 实现，默认方法返回空结果。
- `index.ts` 的 `registry` 注册六大源，`getProvider(source)` 按源取实例；登录态由 `src/main/auth/credentials.ts` 启动时读 cookie 注入 `provider.credentials`。

**移植铁律**：音源实现是 Android Kotlin/C++ 的**逐字移植**，禁止凭记忆或网络试错（签名/加密/设备指纹风控极敏感）。改某源前先读 Android 版坤音（<https://github.com/ikunshare/kunyin>）对应 Kotlin 源。非显然坑已散落在 `src/main/providers/` 与 `src/main/crypto/` 的注释里，例如：QQ 搜索必须走签名 `musics.fcg`（不是 `musicu.fcg`）；QRC 是改版 DES（`crypto/qqDes.ts`）；移植 C 位运算加密务必逐处 `>>>0` 保证 uint32 回绕（否则 mflac 解密输出=输入）。

## 播放地址解析与音频流（关键链路）

播放/下载共用的统一解析入口是 `src/main/providers/getUrl.ts` 的 `resolveMediaInfo(item, qualityId)`：

1. 本地歌曲直接短路；
2. 命中 `urlCache` 直接返回；
3. Provider 自定义 `resolveMediaInfo` 优先，否则回退自建后端 `POST https://c.wwwweb.top/app/getUrl`（body `{platform, musicId, quality, authst}`；`platform` 用 `BACKEND_PLATFORM` 映射，`musicId` 按源取 mid/hash/id，`authst` 来自卡密）；
4. 结果按直链时效缓存（切回听过的歌不重复请求）。

返回 `{url, ekey}`：**无 ekey = 明文直链**，渲染层 `<audio>` 直连（CSP `media-src` 放行 http/https）；**有 ekey = 加密流**（QQ mflac 等），走自定义协议 `kunyin://`（`src/main/audio/protocol.ts`，`protocol.handle` 边下边解密、透传 Range、支持 seek）。卡密校验在 `src/main/auth/manager.ts`（`POST /app/checkAuth`，校验通过即把卡密当 `authst` 用）。

## IPC 契约

- channel 常量全在 `src/common/types/ipc.ts` 的 `IpcChannels`，类型面是 `WindowApi`。
- 主进程 `src/main/ipc/handlers/` 按域拆分（app/window/settings/search/player/comment/auth/library/discover/download/account/redirect/shell/log），`index.ts` 统一 `registerIpc()`；`helpers.ts` 提供 `handle()`（带 try/catch + 日志）与 `sendToRenderer` / `sendToAllRenderers`。
- preload 里每个方法映射到对应 channel；**传 `MusicItem` 过 IPC 前必须先 `toPlain`**（Pinia 响应式 Proxy 无法被 structuredClone，会抛 DataCloneError）。preload 已统一处理，主进程 handler 之间再转发时同样要注意。

## 存储与缓存

- **SQLite**：`src/main/store/db.ts`（better-sqlite3 同步 API），schema v7，四张表 `songs/playlists/playlist_songs/song_redirects`，1:1 移植 Android `MusicDatabase.kt`。系统歌单是 `is_system=1` 的行（`trial`=试听列表兼「最近播放」、`favorites`=我的收藏），启动 seed。数据方法面在 `src/main/store/library.ts`（对应 `LocalMusicStore.kt`，含 `*Direct` 无副作用变体供同步/备份用）。
- **设置**：`src/main/store/settings.ts`，JSON 原子写，不走 SQLite。
- **缓存**：`src/main/cache/`（audioCache 分块磁盘缓存 / lyricCache / urlCache / lruStore）。
- 数据目录：启动时 `initAppDataDir()`（`src/main/core/paths.ts`）把数据迁到 `userData/data/`，与 Chromium 数据分离。用户数据默认在 `%APPDATA%/kunyin-desktop`（Win）、`~/Library/Application Support/kunyin-desktop`（macOS）、`~/.config/kunyin-desktop`（Linux）。

## 常驻模块

`src/main/modules/index.ts` 的 `registerModules()` 启动时挂载：devtools（Ctrl+F12）、media（全局媒体键/托盘/开机自启）、sync（LX Music 同步客户端）、backup（备份/导入）、updater（electron-updater）、desktop-lyrics（桌面歌词悬浮窗）、playlist-refresh（远程歌单自动刷新）、shortcuts（全局快捷键）。模块间用 `src/main/core/events.ts` 的类型化事件总线 `appEvent` 解耦（`app-inited` / `main-window-created` / `settings-updated`）。

## 渲染层与 UI 方向

- 路由（`src/renderer/src/router/index.ts`，hash 模式）：`MainLayout` 外壳子路由（search/discover/charts/playlists/download/settings + 详情页 playlist/album/artist/local），`/player` 是**全屏顶层路由**（覆盖外壳）。启动恢复上次页面（localStorage `kunyin:lastRoute`，播放页不记）。
- 状态用 Pinia（`src/renderer/src/stores/`：player/search/library/settings/download/artist/mv）。
- **UI 方向（用户已定）**：全屏播放器页 = Apple Music 招牌（封面取色流体渐变 `FluidBackground` + 逐字歌词 + 白色前景）；其余页面 = LX Music 风（绿意浅色，单主色派生换肤引擎 `src/renderer/src/theme/`，运行期注入 CSS 变量）。**不要自创中性色板或「AI 味」设计**，列表/设置/详情用 LX 语义变量（`--color-primary-background(-hover/-active)`、`--color-font(-label)`、`--color-button-*`）。

## Vendored 第三方代码

- 歌词引擎 vendored 在 `src/renderer/src/lyric/`（music-lyric-kit 解析 + music-lyric-player 渲染，纯 DOM、零框架依赖），背景在 `src/renderer/src/bg-render/`（AMLL MeshGradient，WebGL + gl-matrix）。eslint 已忽略 `lyric/**`、对 `bg-render` 关显式返回类型；对这些目录的改动须标 `[vendor patch]` 并登记 `src/renderer/src/lyric/README.md`，保持与上游可对照。别名让业务侧 import 名不变，将来换回 npm 包只动 `electron.vite.config.ts` 与 tsconfig。

## 发布与自动更新

- 版本号在 `package.json`，**不带 `v` 前缀**。打 `vX.Y.Z` 标签（须与 version 严格一致）并 push → `.github/workflows/release.yml` 自动建 Release 并在 Windows/macOS/Linux 三平台构建 + 上传安装包与 `latest*.yml`。
- 用户端自动更新走 electron-updater（GitHub Releases provider，`electron-builder.yml` 的 `publish`），设置页「软件更新」手动检查，启动静默检查。
