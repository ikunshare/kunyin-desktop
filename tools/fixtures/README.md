# 测试夹具

`tools/*.test.mjs` 用到的小样本。都是合成的正弦，不含任何受版权保护的音频。

## AC-3 / E-AC-3（`tools/dolbyDecoder.test.mjs`）

每个声道一个频率，测试靠频率认声道：

| 文件               | 编码        | 声道 → 频率                                             |
| ------------------ | ----------- | ------------------------------------------------------- |
| `sine-5.1.ac3`     | AC-3 448k   | FL 300 / FR 500 / FC 700 / LFE 60 / SL 900 / SR 1100 Hz |
| `sine-5.1.eac3`    | E-AC-3 384k | 同上                                                    |
| `sine-stereo.eac3` | E-AC-3 192k | L 440 / R 1000 Hz                                       |

用任意带 ac3/eac3 编码器的 ffmpeg 生成（`join` 必须写明 `map`：输入是单声道，
不写的话它按声道名把第一路配给 FC）：

```bash
S=":d=1:sample_rate=48000"
IN6="-f lavfi -i sine=f=300$S -f lavfi -i sine=f=500$S -f lavfi -i sine=f=700$S \
     -f lavfi -i sine=f=60$S -f lavfi -i sine=f=900$S -f lavfi -i sine=f=1100$S"
J6='[0][1][2][3][4][5]join=inputs=6:channel_layout=5.1(side):map=0.0-FL|1.0-FR|2.0-FC|3.0-LFE|4.0-SL|5.0-SR'
ffmpeg $IN6 -filter_complex "$J6" -c:a ac3 -b:a 448k sine-5.1.ac3
ffmpeg $IN6 -filter_complex "$J6" -c:a eac3 -b:a 384k sine-5.1.eac3
ffmpeg -f lavfi -i sine=f=440$S -f lavfi -i sine=f=1000$S \
  -filter_complex '[0][1]join=inputs=2:channel_layout=stereo:map=0.0-FL|1.0-FR' \
  -c:a eac3 -b:a 192k sine-stereo.eac3
```

## MP4 封装（`tools/dolbyStream.test.mjs`）

把上面的裸码流原样封进 MP4，两个文件恰好是两种布局。AC-4 没有开源编码器，没有这类夹具，
测试里现场拼 MP4、用假解码器（见 `dolbyStream.test.mjs`）。

| 文件                | 来源            | 布局                                      |
| ------------------- | --------------- | ----------------------------------------- |
| `sine-5.1-eac3.mp4` | `sine-5.1.eac3` | faststart：moov 在 mdat 前（QQ 杜比同款） |
| `sine-5.1-ac3.mp4`  | `sine-5.1.ac3`  | moov 在文件尾（ffmpeg 默认）              |

```bash
ffmpeg -i sine-5.1.eac3 -c copy -movflags +faststart sine-5.1-eac3.mp4
ffmpeg -i sine-5.1.ac3 -c copy sine-5.1-ac3.mp4
```
