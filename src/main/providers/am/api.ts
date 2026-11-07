/* eslint-disable @typescript-eslint/no-explicit-any */
import { GET_URL_ENDPOINT } from '@common'
import { currentAuthst } from '../../auth/manager'
import { requestJson } from '../../net/request'

const API_ORIGIN = new URL(GET_URL_ENDPOINT).origin

export interface AmResponse {
  code?: number | string
  message?: string
  data?: any
  info?: any
  result?: any
  total?: number
  hasNext?: boolean
  page?: number
  size?: number
  discs?: any[]
  [key: string]: any
}

export async function amPost(path: string, body: Record<string, unknown>): Promise<AmResponse> {
  const response = await requestJson<AmResponse>(new URL(path, `${API_ORIGIN}/`).toString(), {
    method: 'POST',
    headers: { 'X-Api-Key': currentAuthst() },
    body
  })
  if (Number(response?.code) !== 200) {
    throw new Error(response?.message || 'Apple Music 服务请求失败')
  }
  return response
}
