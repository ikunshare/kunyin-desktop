<p align="center"><a href="https://github.com/ikunshare/kunyin-desktop"><img width="200" src="https://raw.githubusercontent.com/ikunshare/kunyin-desktop/main/resources/icons/icon.png" alt="kunyin logo"></a></p>

<p align="center">
  <h1 align="center">坤音 KunYin Desktop</h1>
</p>

<p align="center">
  <a href="https://github.com/ikunshare/kunyin-desktop/releases"><img src="https://img.shields.io/github/v/release/ikunshare/kunyin-desktop" alt="Release version"></a>
  <a href="https://github.com/ikunshare/kunyin-desktop/actions/workflows/release.yml"><img src="https://github.com/ikunshare/kunyin-desktop/actions/workflows/release.yml/badge.svg" alt="Build status"></a>
  <a href="https://github.com/ikunshare/kunyin-desktop/blob/main/LICENSE"><img src="https://img.shields.io/github/license/ikunshare/kunyin-desktop" alt="License"></a>
  <a href="https://electronjs.org/releases/stable"><img src="https://img.shields.io/github/package-json/dependency-version/ikunshare/kunyin-desktop/dev/electron/main" alt="Electron version"></a>
</p>

<p align="center">聚合多平台音源的桌面音乐播放器</p>

## 说明

坤音（KunYin）是一个基于 Electron + Vue 3 + TypeScript 开发的桌面音乐播放器，聚合了多个在线音乐源，提供统一的多端一致的搜索、播放、歌单与下载体验。

本项目代码为纯AI生成，介意不要使用。

所用技术栈：

- Electron 39+
- Vue 3
- TypeScript
- electron-vite / electron-builder

已支持的运行平台：

- Windows 10 及以上
- macOS
- Linux

已支持的在线音源：

- 网易云音乐（`wy`）
- QQ 音乐（`qq`）
- QQ 音乐云（`qqc`，搜索走自建后端缓存）
- 酷狗音乐（`kg`）
- 酷我音乐（`kw`）
- JOOX（`joox`）

> 移动端（Android）项目：<https://github.com/ikunshare/kunyin>

## 主要功能

- 多音源聚合搜索（单曲 / 专辑 / 歌手）
- 在线歌单 / 专辑 / 歌手页，登录后的「我的歌单」
- 多档音质播放与下载（128K / 320K / 无损 / Hi-Res / 臻品等）
- 歌词展示：逐行 / 逐字 / 翻译 / 音译，桌面歌词悬浮窗
- 本地音乐导入、收藏（我喜欢）、最近播放、自建歌单
- 卡密激活、平台账号登录（QQ / 网易云 / 酷狗）
- LX 数据同步（多端歌单 / 收藏同步）
- 备份与恢复、LX 歌单导入导出
- 代理设置、多主题、字体 / 窗口尺寸自定义
- 内置自动更新（`electron-updater`）

## 下载

软件安装包请到 [GitHub Releases](https://github.com/ikunshare/kunyin-desktop/releases) 下载：

- Windows：`kunyin-desktop-<version>-setup.exe`
- macOS：`kunyin-desktop-<version>.dmg`
- Linux：`kunyin-desktop-<version>.AppImage` / `.deb`

目前本项目的官方发布渠道只有 [GitHub Releases](https://github.com/ikunshare/kunyin-desktop/releases)，其他渠道均为第三方转载，与本项目无关。

## 源码使用方法

### 环境要求

- Node.js 20+
- npm

### 安装依赖

```bash
npm install
```

### 开发调试

```bash
npm run dev
```

### 类型检查 / 代码检查

```bash
npm run typecheck
npm run lint
```

### 打包构建

```bash
# Windows
npm run build:win

# macOS
npm run build:mac

# Linux
npm run build:linux
```

构建产物输出在 `dist/` 目录。

## 软件内更新与发布流程

本项目的自动更新基于 [electron-updater](https://www.electron.build/auto-update) + GitHub Releases：

- 发布配置见 `electron-builder.yml` 的 `publish`（`provider: github`）。
- 打包时 electron-builder 会自动生成各平台的更新元数据 `latest.yml`（Windows）、`latest-mac.yml`（macOS）、`latest-linux.yml`（Linux），并随安装包一起上传到 Release。
- 用户端在「设置 → 关于 → 软件更新」点击「检查更新」即可发现新版本并自动下载、重启安装；启动时也会静默检查一次。

### 发布一个新版本

1. 修改 `package.json` 中的 `version`（遵循语义化版本，且不要带 `v` 前缀）。
2. 提交改动并打上 `v` 前缀的标签（标签须与 `version` 一致，例如 `version: 1.0.4` → 标签 `v1.0.4`）：

   ```bash
   git add .
   git commit -m "chore: release 1.0.4"
   git tag v1.0.4
   git push origin main --tags
   ```

3. 推送标签后，[Release 工作流](.github/workflows/release.yml) 会自动：
   - 创建正式 Release 并自动生成更新日志（`gh release create --generate-notes`）；
   - 在 Windows / macOS / Linux 三平台并行构建，并以 `--publish always` 上传安装包与 `latest*.yml`。

4. 用户即可在客户端内收到更新提示。

> 说明：标签 `vX.Y.Z` 必须与 `package.json` 的 `version` 严格一致，否则 electron-builder 无法正确发布到对应标签。如需重跑发布，请先删除已存在的同名 Release（`create-release` 步骤已做幂等判断，但已发布资产不会自动覆盖）。

## 数据存储目录

默认情况下，软件数据存储在：

- Windows：`%APPDATA%/kunyin-desktop`
- macOS：`~/Library/Application Support/kunyin-desktop`
- Linux：`$XDG_CONFIG_HOME/kunyin-desktop` 或 `~/.config/kunyin-desktop`

## 免责声明

本项目仅供技术学习与交流使用，不提供任何音频文件的存储与分发能力。所有在线音源数据均从其公开接口拉取，本项目不对数据的合法性、准确性负责。

**请尊重版权，支持正版。** 使用本项目产生的任何直接或间接后果由使用者自行承担。

## 贡献

欢迎提交 Issue 与 PR。贡献前请先阅读「源码使用方法」搭建开发环境，并：

- 新增功能建议先开 Issue 说明，确认后再提交 PR；
- 修复 bug 的 PR 请附上复现方式与修复说明。

## 项目协议

本项目基于 [MIT License](./LICENSE) 开源，Copyright (c) 2026 ikunshare。
