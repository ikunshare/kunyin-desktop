/**
 * 按 settings.network.proxy 应用系统级代理（作用于 Electron session：net.fetch、<audio> 直连、
 * kunyin:// 协议取流都受益）。启动时应用一次，设置变更后重应用。
 *
 * 关键：setProxy 是全局的，一条指向死端口的规则会让**所有**走 session 的请求失败
 * （封面 502、取流 502、<audio> ERR_PROXY_CONNECTION_FAILED），而 Node 全局 fetch 不读
 * session 代理，于是「接口通、播放全挂」——极难排查。故应用前先 TCP 探活，不可达就回落直连。
 */
import { session } from 'electron'
import { connect } from 'node:net'
import type { ProxyStatus } from '@common'
import { getSettings } from '../store/settings'

let status: ProxyStatus = { enabled: false, active: false }
/** 连续改设置时防竞态：只有最后一次调用的结果算数 */
let applySeq = 0

/** TCP 探活：代理端口连不上就别把全局流量塞给它 */
function probe(host: string, port: number, timeout = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = connect({ host, port })
    let settled = false
    const done = (ok: boolean): void => {
      if (settled) return
      settled = true
      sock.destroy()
      resolve(ok)
    }
    sock.setTimeout(timeout)
    sock.once('connect', () => done(true))
    sock.once('timeout', () => done(false))
    sock.once('error', () => done(false))
  })
}

export async function applyProxy(): Promise<void> {
  const seq = ++applySeq
  const p = getSettings().network.proxy
  const ses = session.defaultSession

  if (p.enable && p.host && p.port > 0) {
    const reachable = await probe(p.host, p.port)
    if (seq !== applySeq) return // 探活期间设置又变了，交给后一次调用
    if (reachable) {
      await ses.setProxy({
        // 显式带 scheme：不带前缀时 Chromium 的解析规则依赖上下文，写全更稳
        proxyRules: `http://${p.host}:${p.port}`,
        // <local> = 无点号的简单主机名走直连（回环地址 Chromium 本就默认绕过）
        proxyBypassRules: '<local>'
      })
      status = { enabled: true, active: true }
      return
    }
    const reason = `代理 ${p.host}:${p.port} 不可达，已回落直连`
    console.warn(`[proxy] ${reason}`)
    status = { enabled: true, active: false, reason }
  } else {
    status = { enabled: false, active: false }
  }

  await ses.setProxy({ mode: 'direct' })
}

export function getProxyStatus(): ProxyStatus {
  return status
}
