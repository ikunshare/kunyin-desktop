/**
 * 网页版坤音账号 IPC：QQ 登录（快捷 / 扫码）与名下卡密管理。
 * 会话 cookie 由主进程持有，渲染层拿不到明文。
 */
import {
  IpcChannels,
  type AuthState,
  type KunyinAccount,
  type KunyinKeyResult,
  type KunyinLoginResult,
  type KunyinQRCode,
  type KunyinQRPoll,
  type LocalQQAccount
} from '@common'
import { handle } from '../helpers'
import {
  bindKey,
  getAccount,
  groupCode,
  localAccounts,
  logout,
  migrateKey,
  qrNew,
  qrPoll,
  quickLogin,
  refreshAccount
} from '../../auth/kunyin'
import { validateAndSave } from '../../auth/manager'

export function registerKunyinHandlers(): void {
  handle(IpcChannels.KUNYIN_ACCOUNT_GET, (): KunyinAccount => getAccount())
  handle(IpcChannels.KUNYIN_ACCOUNT_REFRESH, (): Promise<KunyinAccount> => refreshAccount())
  handle(IpcChannels.KUNYIN_ACCOUNT_LOGOUT, (): Promise<KunyinAccount> => logout())
  handle(IpcChannels.KUNYIN_LOGIN_LOCAL_ACCOUNTS, (): Promise<LocalQQAccount[]> => localAccounts())
  handle(IpcChannels.KUNYIN_LOGIN_QUICK, (uin: string): Promise<KunyinLoginResult> =>
    quickLogin(uin)
  )
  handle(IpcChannels.KUNYIN_LOGIN_QR_NEW, (): Promise<KunyinQRCode> => qrNew())
  handle(IpcChannels.KUNYIN_LOGIN_QR_POLL, (qrsig: string): Promise<KunyinQRPoll> => qrPoll(qrsig))
  // 选用卡密 = 原有的 authst 校验 + 持久化，直接复用
  handle(IpcChannels.KUNYIN_KEY_USE, (key: string): Promise<AuthState> => validateAndSave(key))
  handle(IpcChannels.KUNYIN_KEY_BIND, (key: string): Promise<KunyinKeyResult> => bindKey(key))
  handle(IpcChannels.KUNYIN_KEY_MIGRATE, (oldKey: string): Promise<KunyinKeyResult> =>
    migrateKey(oldKey)
  )
  handle(IpcChannels.KUNYIN_KEY_GROUP_CODE, (key: string): Promise<KunyinKeyResult> =>
    groupCode(key)
  )
}
