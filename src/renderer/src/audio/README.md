# 音效处理图与 vendored 资源

`soundEffect.ts` 是本目录唯一的业务代码（均衡器 / 环境混响 / 3D 环绕 / 升降调 / 最大声道输出），
结构逐条移植自 lx-music-desktop。它旁边的两份资源来自上游，属于 vendored 内容。

| 路径                       | 来源                                                                                                                      | 说明                              |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| `filters/*.wav`            | lx-music-desktop（Apache-2.0, © lyswhut）`src/renderer/assets/medias/filters/`                                            | 13 条环境混响脉冲响应，共约 6.6MB |
| `pitch-shifter.worklet.js` | [olvb/phaze](https://github.com/olvb/phaze)（MIT），经 lx-music-desktop `src/renderer/plugins/player/pitch-shifter/` 取得 | 变调用的 phase vocoder            |

`filters/` 里只收了 `@common/audio` 的 `CONVOLUTION_PRESETS` 实际引用到的那几条；
上游还有一个 `medium-room1.wav` 没有被任何预设用到，没有一起拿过来。

各预设的干声 / 湿声增益（`mainGain` / `sendGain`）也是照抄上游的——那些数字是调出来的听感，
不要凭感觉改。均衡器的频点、Q 值、9 组预设曲线同理，全在 `@common/audio` 里。

## 现有 [vendor patch]

| 位置                       | 改动                                                                                                                  | 原因                                                                                                                                                                                                   |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pitch-shifter.worklet.js` | 把上游的 `fft.js` + `ola-processor.js` + `phase-vocoder.js` 按依赖序拼成一个文件，删掉 `import` / `export default` 行 | AudioWorklet 的模块脚本在 Chromium 里不支持静态 `import`；上游靠 webpack 打包解决，而我们用 Vite 的 `?url` 引它——`?url` 只是原样拷贝资源、不跟着打包依赖，拆成三个文件必然加载失败。除此之外一行未动。 |

## 改这一块之前要知道的

- **懒建图**：`createMediaElementSource` 一旦建立就撤不回来，之后 `<audio>` 的声音只能经
  AudioContext 出去。所以只有用户真开了某项音效才建图；全默认值时播放链路与没有这个功能时
  完全一致，也就不会被自动播放策略卡成静音（AudioContext 在拿到用户手势前是 suspended）。
- **频谱有两条来源**：没建图时走 `stores/player.ts` 里的 `captureStream` 旁路，建了图就改用
  图里的 analyser。两者不能同时用——建图后 capture 到的是静音，还会白挂一堆摘不掉的 sink。
- **输出设备**：建图后 sinkId 必须设到 `AudioContext` 上，设在 `<audio>` 上不起作用。
  LX 界面里那句「音效设置与自定义音频输出设备冲突，目前此问题暂无法解决」就是没绕过这点；
  `AudioContext.setSinkId` 在**安全上下文**里可用（Electron 44 实测：`file://`/`http://localhost`
  下有，`data:` 页面里没有），渲染层正好满足，所以这里统一收口到 `setSinkId()`。
