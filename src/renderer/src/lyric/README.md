# Vendored 歌词引擎

`music-lyric-kit` / `music-lyric-player` 的上游源码，内嵌进项目以便直接修改引擎行为。

| 目录      | 来源                                                               | 版本    |
| --------- | ------------------------------------------------------------------ | ------- |
| `kit/`    | https://github.com/music-lyric/music-lyric-kit-node（解析器）      | v0.18.0 |
| `player/` | https://github.com/music-lyric/music-lyric-player-web（播放/渲染） | v0.18.1 |

`kit/main`、`player/main` 分别对应 npm 上的 `music-lyric-kit`、`music-lyric-player` 两个聚合包，
在 `electron.vite.config.ts` 与 `tsconfig.web.json` 里以原包名做了别名 —— 业务侧 `import` 写法不变。

数据模型 `music-lyric-model` 仍走 npm：它是 protobuf 代码生成产物，改它需要 `.proto` 与 buf 工具链。

## 约定

- **不套本项目的 lint/prettier**（`eslint.config.mjs` 已忽略此目录），保持与上游逐字节可对照。
- 所有本地修改一律标 `[vendor patch]` 注释并写明原因，方便升级时逐条重放。
- `tsconfig.web.json` 关掉了 `noUnusedLocals` / `noUnusedParameters`：上游未启用，且实现接口时
  保留未用形参（`override check(ctx)`）是必要的。我们自己的代码仍由 eslint 的 `no-unused-vars` 覆盖。

## 现有 [vendor patch]

背景人声渲染方式的整体改造（2026-07-26）：

| 位置                                                               | 改动                                                                                                                                                                                                                    | 原因                                                                                                                                                                     |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `player/dom/components/line/normal/index.ts` + `index.module.scss` | 背景人声改为**主行行内子行**：在主词下渲染常显小字子行，复用 `SyllableElement` 逐字动画、按背景 content 自身时间轴擦除；构造收窄为 `ParsedLineNormal`，删 `isBackground`/`updateBackgroundDelay`/`.background` 浮现样式 | 上游独立背景行激活才浮现、推挤后续行（整页布局跳动），还带主行注解副本，小屏折成一团；模型层拼接（背景词接主词末尾）则时序全错——和声与主词时间交叠，应按各自时间并行擦除 |
| `player/dom/core/line.ts` + `core/layout.ts`                       | 删背景 element 的创建、`isBackground` 布局特判（非激活叠高/激活推高）、enter/retract 延迟计算、`normal-background` 高度桶                                                                                               | 随上行改动，独立背景行已不存在                                                                                                                                           |

其余 patch：

| 位置                                                                    | 改动                                                                                                                                                 | 原因                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `player/dom/constants/role.ts`                                          | 新增 `PlayerRole.footer`                                                                                                                             | 歌词末尾附注区（制作人信息）需要一个角色标识                                                                                                                                                                                                                                                                                                                           |
| `player/dom/components/container/index.ts` + `index.module.scss`        | 新增常驻 `footer` 子元素：`clearChild` 改为 `replaceChildren(footerDom)` 保留它，并加 `updateFooterStyle` / `hideFooter` / `footerHeight` / `footer` | 制作人信息要作为歌词流的收尾**跟着最后一行一起滚动**（Apple Music 的排法）。挂在歌词面板外的独立区块不会随歌词滚动；而行元素由引擎窗口化管理（远处的行会被 detach），从外部同步位置不可靠。注意 `.footer` 样式表里默认 `visibility:hidden`（首帧未定位时别糊在容器顶部），故 `updateFooterStyle` 必须显式写 `visible` —— 置空只是删掉 inline 声明、会回落到那条 hidden |
| `player/dom/core/layout.ts`                                             | `update()` 末尾按末行排版结果定位 footer（`lastTop + lastHeight + gap + offset`），transition 取与末行同款                                           | 同上。不纳入 `lineManager`：它不是唱词，不该参与激活判定、窗口化与逐字动画                                                                                                                                                                                                                                                                                             |
| `player/dom/core/index.ts`                                              | 新增 `footerElement` getter 与 `refreshFooter()`                                                                                                     | 业务侧填充附注内容，并在内容变化后按新高度重排                                                                                                                                                                                                                                                                                                                         |
| `player/dom/.../syllable/word.ts`                                       | `forceOwnWipe` 由硬编码 `true` 改读配置                                                                                                              | 恒为 true 时逐字音译永远自走时钟，与主词擦除不同步（「主词播主词的、音译播音译的」）                                                                                                                                                                                                                                                                                   |
| `player/dom/config/.../syllable/annotation/index.ts` + `config/root.ts` | 新增 `forceOwnWipe` 配置项，默认 `false`                                                                                                             | 同上，给出开关                                                                                                                                                                                                                                                                                                                                                         |
| `player/dom/.../syllable/index.module.scss`                             | `.annotation-row` 的 `width: 100%` → `max-content`                                                                                                   | 钉死在单字宽会让拼音横向溢出到邻字                                                                                                                                                                                                                                                                                                                                     |
| 同上                                                                    | `.annotation-row` 的 `min-height: 1em` → `auto`                                                                                                      | 1em 装不下 `g/p/y` 下降部，而擦除 mask 按 `clientHeight` 生成，会连下降部一起切掉                                                                                                                                                                                                                                                                                      |
| `kit/core/plugin/base.ts`                                               | `ConfigManager<any, any>` → `<any, any, any>`                                                                                                        | 源码直连后 TS 会算出真实 `Keys`，`Set<Keys>` 处于逆变位导致各插件无法赋值                                                                                                                                                                                                                                                                                              |
| `kit/plugin-format-lrc/generator/line.ts`                               | 空数组字面量补 `string[]`                                                                                                                            | strict 下推断为 `never[]`（上游未开 `noImplicitAny`）                                                                                                                                                                                                                                                                                                                  |
| `kit/utils/string/replace.ts`                                           | `isRegExp()` → `instanceof RegExp`                                                                                                                   | lodash 的 `isRegExp` 签名不是类型守卫，未缩窄类型                                                                                                                                                                                                                                                                                                                      |
| `kit/plugin-transform-pure/extract/constants.ts`                        | 职务规则补 `语言顾问\|语顾问\|语言` / `Language Consultant\|Language`，乐器规则补 `巴扬` / `Bayan`（中英各一条，插在对应位置保持两表平行）        | exact 模式要求职务文本 ≥50% 字符被规则覆盖：「俄语顾问 Russian Language Consultant」只靠 `顾问`+`Consultant` 覆盖 12/32、「巴扬 Bayan」覆盖 0/8，制作人行漏进唱词                                                                                                                                                                                                       |

## 升级上游

```bash
git clone --depth 1 --branch <tag> <kit 仓库>    /tmp/kit
git clone --depth 1 --branch <tag> <player 仓库> /tmp/player
node tools/vendor-lyric.mjs /tmp/kit /tmp/player   # 全量覆盖 + 改写 import
node tools/check-lyric-barrels.mjs                # 确认无解析不到的 import（应全为 0）
```

脚本会**覆盖**本目录，上表的 patch 需按注释逐条重放 —— 务必先 `git diff` 核对。
随后跑 `tools/verify/` 下的验证：

```bash
npx vite build --config tools/verify/vite.config.mts && node tools/verify/out/lyric.spec.mjs
```
