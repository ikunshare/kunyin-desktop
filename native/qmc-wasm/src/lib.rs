//! QQ 音乐 mflac/mgg（QMC2）流密码热循环的 wasm 实现。
//!
//! 只搬**每字节都要跑**的部分：map / RC4 两种流密码 + 它们的一次性初始化。
//! ekey 的 base64/TEA 解密留在 TS 侧（每首歌只跑一次，没有搬的价值），
//! 解出的原始 key 由 TS 写进 `key_ptr()` 后调用 `map_init` / `rc4_init`。
//!
//! 逐字移植自 `src/main/crypto/mflac.ts`（它本身 1:1 移植自 cpp/MflacCrypto/MflacCrypto.cpp）。
//! **改这里必须同步改 TS 回退实现**，两边由 tools/qmc.test.mjs 的共同向量校验。
//!
//! 移植坑（与 TS 注释对应）：
//! - `rc4_hash` 是 uint32 乘法回绕 —— Rust 用 `wrapping_mul`，对应 JS 的 `Math.imul(...)>>>0`；
//! - `rc4_segment_key` 是**浮点**除法（JS `Math.floor(hash/((id+1)*seed)*100.0)`），
//!   必须用 f64 复现，换成整数除法结果会不一样；
//! - 该浮点结果在 JS 侧分别经历 `% n`（浮点取余）和 `& 0x1ff`（ToInt32 截断到 u32 再掩码），
//!   Rust 侧对应 `v as u64 % n` 和 `(v as u64) as u32 & 0x1ff`，顺序不能省；
//! - `key_compress` 里的 `(b << s) | (b >> s)` 不是循环移位，是原实现的怪癖，照抄。
//!
//! 状态是模块级 static —— 每个解密器实例化一份独立的 `WebAssembly.Instance`，
//! 因此并发的播放流 / 下载任务之间不会互相踩。

#![no_std]

// —— 常量（与 TS/C++ 逐字一致）——
const V1_KEY_SIZE: usize = 128;
const V1_OFFSET_BOUNDARY: u64 = 0x7fff;
const FIRST_SEGMENT_SIZE: u64 = 0x0080;
const OTHER_SEGMENT_SIZE: u64 = 0x1400;
const RC4_STREAM_CACHE_SIZE: usize = 0x1400 + 512;

/// 原始 key 上限。真实 ekey 解出的 key 在 256～512B 量级，8K 留足余量；
/// 超限时 TS 侧回退到纯 JS 实现。
const MAX_KEY: usize = 8192;
/// 单次 decrypt 能吞的字节数。上游 chunk 通常 ≤64KB，整文件解密由 TS 侧按此分块。
const IO_CAP: usize = 128 * 1024;

static mut KEY: [u8; MAX_KEY] = [0; MAX_KEY];
static mut KEY_LEN: usize = 0;
static mut MAP_KEY: [u8; V1_KEY_SIZE] = [0; V1_KEY_SIZE];
/// MAP_KEY 首尾相接复制两份：让 XOR 主循环能从任意相位做**非对齐 8 字节**读取，
/// 不必逐字节回绕下标（见 `xor_periodic`）。
static mut MAP_PAD: [u8; V1_KEY_SIZE * 2] = [0; V1_KEY_SIZE * 2];
static mut RC4_S: [u8; MAX_KEY] = [0; MAX_KEY];
static mut RC4_STREAM: [u8; RC4_STREAM_CACHE_SIZE] = [0; RC4_STREAM_CACHE_SIZE];
static mut RC4_HASH: u32 = 0;
static mut IO: [u8; IO_CAP] = [0; IO_CAP];

#[panic_handler]
fn panic(_info: &core::panic::PanicInfo) -> ! {
    core::arch::wasm32::unreachable()
}

// —— 内存布局出口（TS 侧据此读写线性内存）——

#[unsafe(no_mangle)]
pub extern "C" fn io_ptr() -> u32 {
    (&raw const IO) as *const u8 as u32
}

#[unsafe(no_mangle)]
pub extern "C" fn io_cap() -> u32 {
    IO_CAP as u32
}

#[unsafe(no_mangle)]
pub extern "C" fn key_ptr() -> u32 {
    (&raw const KEY) as *const u8 as u32
}

#[unsafe(no_mangle)]
pub extern "C" fn key_cap() -> u32 {
    MAX_KEY as u32
}

// —— XOR 主循环（8 字节一拍；wasm 允许非对齐 i64 访存）——

/// `dst[0..n] ^= src[0..n]`
#[inline(always)]
unsafe fn xor_bytes(dst: *mut u8, src: *const u8, n: usize) {
    let mut k = 0usize;
    while k + 8 <= n {
        let a = (dst.add(k) as *const u64).read_unaligned();
        let b = (src.add(k) as *const u64).read_unaligned();
        (dst.add(k) as *mut u64).write_unaligned(a ^ b);
        k += 8;
    }
    while k < n {
        *dst.add(k) ^= *src.add(k);
        k += 1;
    }
}

/// `dst[0..n] ^= MAP_PAD[phase..]`，其中 pad 以 128 字节为周期循环。
/// 128 是 8 的倍数，所以 8 字节步进时相位始终落在 `[0,127]`，
/// 加上 pad 存了两份，`phase+8 <= 135 < 256`，读取永不越界。
#[inline(always)]
unsafe fn xor_periodic(dst: *mut u8, phase: usize, n: usize) {
    let pad = (&raw const MAP_PAD) as *const u8;
    let mut p = phase;
    let mut k = 0usize;
    while k + 8 <= n {
        let a = (dst.add(k) as *const u64).read_unaligned();
        let b = (pad.add(p) as *const u64).read_unaligned();
        (dst.add(k) as *mut u64).write_unaligned(a ^ b);
        k += 8;
        p += 8;
        if p >= V1_KEY_SIZE {
            p -= V1_KEY_SIZE;
        }
    }
    while k < n {
        *dst.add(k) ^= *pad.add(p);
        k += 1;
        p += 1;
        if p >= V1_KEY_SIZE {
            p = 0;
        }
    }
}

// —— map 流密码（key ≤ 300）——

/// 对应 TS `keyCompress`：把任意长度 key 压成 128B。
#[unsafe(no_mangle)]
pub extern "C" fn map_init(key_len: u32) {
    let n = key_len as usize;
    if n == 0 || n > MAX_KEY {
        return;
    }
    let key = (&raw const KEY) as *const u8;
    let dst = (&raw mut MAP_KEY) as *mut u8;
    for i in 0..V1_KEY_SIZE {
        let idx = (i * i + 71214) % n;
        let b = unsafe { *key.add(idx) } as u32;
        let shift = ((idx + 4) % 8) as u32;
        unsafe { *dst.add(i) = ((b << shift) | (b >> shift)) as u8 };
    }
    // 复制两份供 xor_periodic 做非对齐读取
    let pad = (&raw mut MAP_PAD) as *mut u8;
    for i in 0..V1_KEY_SIZE {
        let b = unsafe { *dst.add(i) };
        unsafe {
            *pad.add(i) = b;
            *pad.add(i + V1_KEY_SIZE) = b;
        }
    }
    unsafe { KEY_LEN = n };
}

/// 原地解密 IO[0..len]；`file_offset` 是首字节在整文件中的绝对偏移。
/// 偏移用 f64 传（JS number 直传，无需 BigInt；2^53 以内精确，远超音频文件尺寸）。
#[unsafe(no_mangle)]
pub extern "C" fn map_decrypt(len: u32, file_offset: f64) {
    let len = len as usize;
    if len == 0 || len > IO_CAP {
        return;
    }
    let io = (&raw mut IO) as *mut u8;
    let base = file_offset as u64;

    // 对应 TS `qmc1Transform`：`off>0x7fff ? off%0x7fff : off`，再 `& 127` 取 key 下标
    // （128 是 2 的幂，`& 127` 等价 `% 128`）。
    //
    // 不逐字节取模：折回后的下标 r 只是「每字节 +1、到 0x7fff 归零」，
    // 所以整段可以拆成若干**不跨回绕点**的 run，run 内下标就是 128 周期的 key，
    // 交给 xor_periodic 按 8 字节一拍 XOR。每 32767 字节才算一次 `%`。
    let mut i = 0usize;
    let mut off = base;
    while i < len {
        let (r, run) = if off <= V1_OFFSET_BOUNDARY {
            // 首段：off 直接当下标，一直用到 off == 0x7fff 为止
            (off, V1_OFFSET_BOUNDARY + 1 - off)
        } else {
            let r = off % V1_OFFSET_BOUNDARY;
            (r, V1_OFFSET_BOUNDARY - r)
        };
        let run = core::cmp::min(run, (len - i) as u64) as usize;
        unsafe { xor_periodic(io.add(i), (r & (V1_KEY_SIZE as u64 - 1)) as usize, run) };
        i += run;
        off += run as u64;
    }
}

// —— RC4 流密码（key > 300）——

/// 对应 TS `rc4Hash`：uint32 乘法回绕，一旦归零或不再增长就停。
fn rc4_hash(key: *const u8, n: usize) -> u32 {
    let mut h: u32 = 1;
    for i in 0..n {
        let k = unsafe { *key.add(i) };
        if k == 0 {
            continue;
        }
        let next = h.wrapping_mul(k as u32);
        if next == 0 || next <= h {
            break;
        }
        h = next;
    }
    h
}

/// 对应 TS `rc4SegmentKey`：**浮点**运算，不能改成整数除法。
///
/// JS 侧末尾是 `Math.floor(...)`，而 no_std 没有 `f64::floor`；这里直接 `as u64` ——
/// 被除数恒为正（hash≥1、(id+1)*seed≥1），向零截断与 floor 等价，
/// 且两个调用方本来就立刻把它当整数用。最大值约 (2^32-1)*100 ≈ 4.3e11，不会溢出。
#[inline(always)]
fn rc4_segment_key(id: u64, seed: u8, hash: u32) -> u64 {
    if seed == 0 {
        return 0;
    }
    ((hash as f64) / (((id + 1) as f64) * (seed as f64)) * 100.0) as u64
}

/// 对应 TS `rc4InitStream`：非标准 KSA/PRGA（`s[i]=i&0xff` 在 n>256 时会截断，
/// PRGA 出的是 `s[(s[si]+s[sj])%n]`），照抄原实现，不要「修正」成标准 RC4。
#[unsafe(no_mangle)]
pub extern "C" fn rc4_init(key_len: u32) {
    let n = key_len as usize;
    if n == 0 || n > MAX_KEY {
        return;
    }
    let key = (&raw const KEY) as *const u8;
    let s = (&raw mut RC4_S) as *mut u8;
    let out = (&raw mut RC4_STREAM) as *mut u8;

    unsafe {
        KEY_LEN = n;
        RC4_HASH = rc4_hash(key, n);

        for i in 0..n {
            *s.add(i) = (i & 0xff) as u8;
        }
        let mut j: usize = 0;
        for i in 0..n {
            j = (j + *s.add(i) as usize + *key.add(i) as usize) % n;
            let t = *s.add(i);
            *s.add(i) = *s.add(j);
            *s.add(j) = t;
        }

        let mut si: usize = 0;
        let mut sj: usize = 0;
        for k in 0..RC4_STREAM_CACHE_SIZE {
            si = (si + 1) % n;
            sj = (sj + *s.add(si) as usize) % n;
            let t = *s.add(si);
            *s.add(si) = *s.add(sj);
            *s.add(sj) = t;
            *out.add(k) = *s.add((*s.add(si) as usize + *s.add(sj) as usize) % n);
        }
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn rc4_decrypt(len: u32, file_offset: f64) {
    let len = len as usize;
    if len == 0 || len > IO_CAP {
        return;
    }
    let io = (&raw mut IO) as *mut u8;
    let key = (&raw const KEY) as *const u8;
    let stream = (&raw const RC4_STREAM) as *const u8;
    let n = unsafe { KEY_LEN };
    let hash = unsafe { RC4_HASH };
    if n == 0 {
        return;
    }

    let mut pos: usize = 0;
    let mut offset = file_offset as u64;

    // 段一：前 0x80 字节，逐字节算 segment key
    if offset < FIRST_SEGMENT_SIZE {
        let block = core::cmp::min(len as u64, FIRST_SEGMENT_SIZE - offset) as usize;
        for i in 0..block {
            let off = offset + i as u64;
            let seed = unsafe { *key.add((off % n as u64) as usize) };
            // JS 侧是 `rc4SegmentKey(...) % n`（整数值浮点取余）→ 等价于先截整再取模
            let idx = (rc4_segment_key(off, seed, hash) % n as u64) as usize;
            unsafe {
                let p = io.add(i);
                *p ^= *key.add(idx);
            }
        }
        pos = block;
        offset += block as u64;
    }

    // 段二：对齐到 0x1400 边界的残块
    let excess = (offset % OTHER_SEGMENT_SIZE) as usize;
    if pos < len && excess != 0 {
        let block = core::cmp::min(len - pos, OTHER_SEGMENT_SIZE as usize - excess);
        let id = offset / OTHER_SEGMENT_SIZE;
        let seed = unsafe { *key.add((id % n as u64) as usize) };
        // JS 侧是 `rc4SegmentKey(...) & 0x1ff`：先 ToInt32（截到 u32）再掩码
        let skip = (rc4_segment_key(id, seed, hash) as u32 & 0x1ff) as usize;
        unsafe { xor_bytes(io.add(pos), stream.add(skip + excess), block) };
        pos += block;
        offset += block as u64;
    }

    // 段三：整 0x1400 块循环
    while pos < len {
        let block = core::cmp::min(len - pos, OTHER_SEGMENT_SIZE as usize);
        let id = offset / OTHER_SEGMENT_SIZE;
        let seed = unsafe { *key.add((id % n as u64) as usize) };
        let skip = (rc4_segment_key(id, seed, hash) as u32 & 0x1ff) as usize;
        unsafe { xor_bytes(io.add(pos), stream.add(skip), block) };
        pos += block;
        offset += block as u64;
    }
}
