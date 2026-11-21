/**
 * 网页版坤音后端（c.wwwweb.top）的账号与卡密管理类型。
 *
 * 对应 ikun-music-api-server 的 /user/*、/cdk/* 接口：
 * - 登录：桌面端在主进程完成新版 QQ 面板流程（本机好友快捷登录），把 OAuth code 交给后端换 musickey；
 *   或走后端代理的扫码流程（二维码图片由后端生成）。
 * - 卡密：登录后 /user/me 返回名下卡密，可选用 / 绑定 / 换卡 / 生成进群验证码。
 */

/** 卡密额度（对齐后端 model.QuotaState） */
export interface KunyinKeyQuota {
  /** 每周期上限，0 表示不限 */
  limit: number
  /** 当前周期已用（只统计付费音源回源成功的取链） */
  used: number
  /** 0 = 有效期内累计；>0 = 从激活起每 N 天重置 */
  periodDays: number
  /** 下次重置时间（带时区偏移的 RFC3339）；不自动重置或未激活时为空 */
  resetAt?: string
  /** 本周期额度已用完 */
  exceeded: boolean
}

/** /user/me 返回的卡密（后端 model.Metadata 的展示子集） */
export interface KunyinKey {
  key: string
  /** week / month / year / permanent */
  type: string
  isActive: boolean
  version: number
  /** 带时区偏移的 RFC3339；未激活时为空 */
  expiresAt: string
  createdAt?: string
  usageCount: number
  boundQQ?: number
  quota?: KunyinKeyQuota
}

/** 当前登录的 QQ 账号与名下卡密 */
export interface KunyinAccount {
  loggedIn: boolean
  musicid?: number
  nickname?: string
  avatar?: string
  encryptUin?: string
  /** musickey 过期时间（秒级时间戳） */
  expiredAt?: number
  keys: KunyinKey[]
}

/** 本机 QQ 客户端里已登录的账号（快捷登录探测结果） */
export interface LocalQQAccount {
  uin: string
  nickname: string
  avatar: string
}

/** 快捷登录结果。no_qq = 本机没有可用的 QQ 客户端，调用方应回退扫码 */
export type KunyinLoginResult =
  { ok: true; account: KunyinAccount } | { ok: false; reason: 'no_qq' | 'failed'; message: string }

/** 扫码登录：后端 /user/qr/new 返回的二维码 */
export interface KunyinQRCode {
  qrsig: string
  /** data:image/png;base64,... 直接塞 <img src> */
  image: string
}

export type KunyinQRStatus = 'wait_scan' | 'scanned' | 'done' | 'expired' | 'refused' | 'error'

/** 扫码轮询结果；status=done 时 account 非空（主进程已拿到会话） */
export interface KunyinQRPoll {
  status: KunyinQRStatus
  message?: string
  account?: KunyinAccount
}

/** 卡密管理类操作结果（绑定 / 换卡 / 进群验证码） */
export type KunyinKeyResult =
  | { ok: true; message: string; newKey?: string; expiresAt?: string; code?: string }
  | { ok: false; message: string }
