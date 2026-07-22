import { IpcChannels, type AuthState } from '@common'
import { handle } from '../helpers'
import { clearAuth, getAuthState, validateAndSave } from '../../auth/manager'

/** 卡密激活相关 IPC。 */
export function registerAuthHandlers(): void {
  handle(IpcChannels.AUTH_GET, (): AuthState => getAuthState())
  handle(IpcChannels.AUTH_VALIDATE, (authst: string): Promise<AuthState> => validateAndSave(authst))
  handle(IpcChannels.AUTH_CLEAR, (): AuthState => {
    clearAuth()
    return getAuthState()
  })
}
