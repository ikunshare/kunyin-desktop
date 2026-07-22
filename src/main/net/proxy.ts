/**
 * 按 settings.network.proxy 应用系统级代理（作用于 Electron session：net.fetch、<audio> 直连、
 * kunyin:// 协议取流都受益）。启动时应用一次，设置变更后重应用。
 */
import { session } from 'electron'
import { getSettings } from '../store/settings'

export async function applyProxy(): Promise<void> {
  const p = getSettings().network.proxy
  const ses = session.defaultSession
  if (p.enable && p.host && p.port > 0) {
    await ses.setProxy({ proxyRules: `${p.host}:${p.port}` })
  } else {
    await ses.setProxy({ mode: 'direct' })
  }
}
