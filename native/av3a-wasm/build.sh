#!/usr/bin/env bash
# 把 MOLAN-AV3A（AVS3-P3 / Audio Vivid 参考解码器的库化封装）+ shim.c 编成一个独立的 wasm
# （wasm32-wasip1 reactor）。神经网络后处理模型已由上游以 C 数组（model.h → g_model）内嵌，
# 不需要任何外部数据文件。
#
# 由 scripts/build-av3a-wasm.mjs 调用（Windows 上经 WSL）：源码包与 wasi-sdk 由 Node 在宿主机
# 下载并校验好，这里只管解包、编译——WSL 里常常连不上外网。
#
# 用法：build.sh <MOLAN 源码包> <wasi-sdk 包> <输出 .wasm 路径>
#
# 编译选项的几个要点：
# - 源文件清单直接取上游 CMakeLists.txt 的 MOLAN_AV3A_LIB_SOURCES，跟着上游走；
# - 与上游 CMake 一样 -DAVS3_NO_MAIN=1（decoder.c 兼作上游 CLI）、-include 静音头（printf → 空函数）、
#   -fsigned-char；
# - **栈要开到 8MB**：参考解码器把整帧的多声道数组放在栈上，wasm-ld 默认 64KB 栈第一帧就越界；
# - -O2 -msimd128：网易 7.1.4 实测约 28× 实时（不开 SIMD 约 20×），输出与不开时逐样本相同。
set -euo pipefail

MOLAN_COMMIT=1564bd332205bb46afee8c643776f833020b94b6
WASI_SDK=34.0

MOLAN_TAR=$(cd "$(dirname "$1")" && pwd)/$(basename "$1")
WASI_TAR=$(cd "$(dirname "$2")" && pwd)/$(basename "$2")
OUT=$3
HERE=$(cd "$(dirname "$0")" && pwd)

case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) WASI_ARCH=x86_64-linux ;;
  Linux-aarch64) WASI_ARCH=arm64-linux ;;
  Darwin-arm64) WASI_ARCH=arm64-macos ;;
  Darwin-x86_64) WASI_ARCH=x86_64-macos ;;
  *) echo "不支持的构建平台：$(uname -s)-$(uname -m)" >&2; exit 1 ;;
esac

# 在本机文件系统里编：WSL 下直接在 /mnt/c 上编译慢得多
WORK=${KUNYIN_AV3A_WORK:-$HOME/.cache/kunyin-av3a-wasm}
mkdir -p "$WORK"
WASI=$WORK/wasi-sdk-$WASI_SDK-$WASI_ARCH
SRC=$WORK/MOLAN-AV3A-$MOLAN_COMMIT
[ -d "$WASI" ] || tar xzf "$WASI_TAR" -C "$WORK"
rm -rf "$SRC"
tar xzf "$MOLAN_TAR" -C "$WORK"

cd "$SRC"
# 上游 CMakeLists 是 CRLF 行尾
SOURCES=$(sed -n '/^set(MOLAN_AV3A_LIB_SOURCES/,/^)/p' CMakeLists.txt | tr -d '\r' |
  grep -E '^[[:space:]]+src/.*\.c' | awk '{print $1}')
[ -n "$SOURCES" ] || { echo "没能从 CMakeLists.txt 取到源文件清单" >&2; exit 1; }

# reactor：没有 main，导出 _initialize 由宿主先调一次（初始化 libc）
"$WASI/bin/clang" --target=wasm32-wasip1 -mexec-model=reactor -O2 -msimd128 -fsigned-char \
  -DAVS3_NO_MAIN=1 -D_WASI_EMULATED_PROCESS_CLOCKS \
  -include src/api/molan_av3a_quiet.h \
  -Iinclude -Isrc/avs3Decoder/include -Isrc/libavs3_common -Isrc/libavs3_debug \
  -Wno-everything \
  $SOURCES "$HERE/shim.c" \
  -lm -lwasi-emulated-process-clocks \
  -Wl,-z,stack-size=8388608 -Wl,--strip-all -Wl,--gc-sections \
  -o "$OUT"

# 许可证与来源说明随构建脚本一起提交（README 与「关于」页引用）
cp LICENSE "$HERE/LICENSE"
cp NOTICE "$HERE/NOTICE"

echo "[av3a-wasm] $(wc -c <"$OUT") B → $OUT"
