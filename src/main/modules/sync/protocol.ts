/** LX Music 同步协议常量（1:1 移植 Android sync/SyncProtocol.kt，与 Go 端 sync/protocol.go 对齐）。 */
export const SyncProtocol = {
  HELLO_MSG: 'Hello~::^-^::~v4~',
  ID_PREFIX: 'OjppZDo6',
  AUTH_MSG: 'lx-music auth::',
  MSG_CONNECT: 'lx-music connect',

  CLOSE_NORMAL: 1000,
  CLOSE_FAILED: 4100,

  FEATURE_LIST: 'list',
  FEATURE_DISLIKE: 'dislike',
  FEATURE_VERSION_LIST: '1',
  FEATURE_VERSION_DISLIKE: '1',

  COMPRESS_PREFIX: 'cg_',
  COMPRESS_THRESH: 1024,

  HEARTBEAT_SECS: 60,
  RPC_TIMEOUT_MS: 120_000,

  /** 客户端声明协议版本；Go 端据此判断是否需要额外发送 "ping" 文本帧。 */
  CLIENT_KIND_MOBILE: 'lx_music_mobile'
} as const
