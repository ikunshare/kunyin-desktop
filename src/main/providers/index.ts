/**
 * Provider 注册与分发。随平台移植逐个接入。
 */
import type { MusicSource } from '@common'
import type { BaseProvider } from './base'
import { WyProvider } from './wy'
import { KwProvider } from './kw'
import { KgProvider } from './kg'
import { QqProvider } from './qq'
import { QqcProvider } from './qqc'
import { JooxProvider } from './joox'

const registry: Partial<Record<MusicSource, BaseProvider>> = {
  wy: new WyProvider(),
  kw: new KwProvider(),
  kg: new KgProvider(),
  qq: new QqProvider(),
  qqc: new QqcProvider(),
  joox: new JooxProvider()
}

export function getProvider(source: MusicSource): BaseProvider | undefined {
  return registry[source]
}
