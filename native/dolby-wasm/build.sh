#!/usr/bin/env bash
# 把 LibreMPEG 的杜比解码器（AC-3 / E-AC-3 / AC-4）+ shim.c 编成一个独立的 wasm（wasm32-wasip1 reactor）。
#
# 用 LibreMPEG（FFmpeg 的分支，https://github.com/librempeg/librempeg）而不是 FFmpeg：
# 网易的杜比全景声是 AC-4，只有它带 AC-4 解码器。AC-3 系两边同源，行为一致。
#
# 由 scripts/build-dolby-wasm.mjs 调用（Windows 上经 WSL）：源码包由 Node 在宿主机下载并校验好，
# 这里只管解包、编译——WSL 里常常连不上外网。
#
# 用法：build.sh <缓存目录> <输出 .wasm 路径>
#   缓存目录里需有 librempeg-$LIBREMPEG_COMMIT.tar.gz 与 wasi-sdk-$WASI_SDK-$WASI_ARCH.tar.gz
#
# 配置只留三个解码器 + ac3 parser。LibreMPEG 整体按 GPLv3+ 发布（见其 LICENSE.md，AC-4 解码器
# 文件头就是 GPLv3），所以显式 --enable-gpl --enable-version3，让 configure 报出的许可证与实际一致；
# 这两个开关在这份精简配置里不会多带进任何代码。
#
# avfilter 不能关：LibreMPEG 让 libavcodec 依赖它（configure 里 avcodec_deps="avfilter"，
# 关了 avcodec 就整个被禁用）；--disable-everything 下它不带任何滤镜。
set -euo pipefail

LIBREMPEG_COMMIT=9c00336e26e45ed1274c9693382b1b1441ccaf6a
WASI_SDK=34.0

CACHE=$(cd "$1" && pwd)
OUT=$2
HERE=$(cd "$(dirname "$0")" && pwd)

case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) WASI_ARCH=x86_64-linux ;;
  Linux-aarch64) WASI_ARCH=arm64-linux ;;
  Darwin-arm64) WASI_ARCH=arm64-macos ;;
  Darwin-x86_64) WASI_ARCH=x86_64-macos ;;
  *) echo "不支持的构建平台：$(uname -s)-$(uname -m)" >&2; exit 1 ;;
esac

# 在本机文件系统里编：WSL 下直接在 /mnt/c 上跑 configure/make 慢一个数量级
WORK=${KUNYIN_DOLBY_WORK:-$HOME/.cache/kunyin-dolby-wasm}
mkdir -p "$WORK"
WASI=$WORK/wasi-sdk-$WASI_SDK-$WASI_ARCH
SRC=$WORK/librempeg-$LIBREMPEG_COMMIT
[ -d "$WASI" ] || tar xzf "$CACHE/wasi-sdk-$WASI_SDK-$WASI_ARCH.tar.gz" -C "$WORK"
[ -d "$SRC" ] || tar xzf "$CACHE/librempeg-$LIBREMPEG_COMMIT.tar.gz" -C "$WORK"

BUILD=$WORK/build-$LIBREMPEG_COMMIT
PREFIX=$WORK/prefix-$LIBREMPEG_COMMIT
rm -rf "$BUILD" "$PREFIX"
mkdir -p "$BUILD"
cd "$BUILD"

"$SRC/configure" --prefix="$PREFIX" \
  --target-os=none --arch=wasm32 --enable-cross-compile \
  --cc="$WASI/bin/clang" --ar="$WASI/bin/llvm-ar" --ranlib="$WASI/bin/llvm-ranlib" \
  --nm="$WASI/bin/llvm-nm" --strip="$WASI/bin/llvm-strip" \
  --sysroot="$WASI/share/wasi-sysroot" \
  --extra-cflags="--target=wasm32-wasip1 -Oz -D_WASI_EMULATED_PROCESS_CLOCKS" \
  --extra-ldflags="--target=wasm32-wasip1" \
  --enable-gpl --enable-version3 \
  --disable-everything --disable-programs --disable-doc --disable-network \
  --disable-autodetect --disable-iconv \
  --disable-pthreads --disable-w32threads --disable-os2threads \
  --disable-asm --disable-inline-asm --disable-runtime-cpudetect \
  --disable-avdevice --disable-avformat --disable-swscale --disable-swresample \
  --disable-debug --disable-faan --enable-small \
  --enable-decoder=ac3,eac3,ac4 --enable-parser=ac3 >configure.log

grep '^License' configure.log

make -j"$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 4)" >make.log 2>&1 || { tail -40 make.log >&2; exit 1; }
make install >/dev/null

# reactor：没有 main，导出 _initialize 由宿主先调一次（初始化 libc）
"$WASI/bin/clang" --target=wasm32-wasip1 -mexec-model=reactor -Oz -flto \
  -I"$PREFIX/include" "$HERE/shim.c" \
  "$PREFIX/lib/libavcodec.a" "$PREFIX/lib/libavfilter.a" "$PREFIX/lib/libavutil.a" \
  -lm -lwasi-emulated-process-clocks \
  -Wl,--strip-all -Wl,--gc-sections \
  -o "$OUT"

echo "[dolby-wasm] $(wc -c <"$OUT") B → $OUT"
