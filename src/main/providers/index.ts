/**
 * Provider 注册与分发。
 */
import type { MusicSource } from '@common'
import type { BaseProvider } from './base'
import { WyProvider } from './wy'
import { KwProvider } from './kw'
import { KgProvider } from './kg'
import { QqProvider } from './qq'
import { QqcProvider } from './qqc'
import { AmProvider } from './am'

const registry: Partial<Record<MusicSource, BaseProvider>> = {
  wy: new WyProvider(),
  kw: new KwProvider(),
  kg: new KgProvider(),
  qq: new QqProvider(),
  qqc: new QqcProvider(),
  am: new AmProvider()
}

export function getProvider(source: MusicSource): BaseProvider | undefined {
  return registry[source]
}
