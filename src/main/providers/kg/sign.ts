/**
 * 酷狗签名与 query 构造（移植自 KgProvider.kt）。
 * kgSign：首尾同一 salt，参数按 key 升序、k=v 无分隔拼接，md5 小写 hex。
 */
import { createHash } from 'node:crypto'

const KG_SALT = 'OIlwieks28dk2k092lksi2UIkp'

export function kgSign(params: Record<string, string>, body = ''): string {
  const joined = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('')
  return createHash('md5')
    .update(KG_SALT + joined + body + KG_SALT, 'utf-8')
    .digest('hex')
}

/** query 编码：Java URLEncoder 语义（空格→+） */
export function buildKgQuery(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(v).replace(/%20/g, '+')}`)
    .join('&')
}

/** 带签名的 query：signature 用未编码原值计算，再整体编码 */
export function signedQuery(params: Record<string, string>): string {
  return buildKgQuery({ ...params, signature: kgSign(params) })
}

export function nowSec(): string {
  return String(Math.floor(Date.now() / 1000))
}
