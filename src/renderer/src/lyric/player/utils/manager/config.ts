import type { NestedKeys } from '../types'

import { Event } from '../event'

import { mergeObject, cloneObjectDeep, compareObject } from '../object'

export interface ConfigManagerEventMap<Full, Keys> {
  update: (changeKeys: Set<Keys>, config: Full) => void
  reset: (config: Full) => void
}

export class ConfigManager<Full, Init, Keys = NestedKeys<Full>> {
  readonly event = new Event<ConfigManagerEventMap<Full, Keys>>()

  private def: Full
  private now: Full

  /**
   * Create a config manager from defaults and an optional initial patch.
   */
  constructor(def: Full, init?: Init) {
    this.def = def
    this.now = cloneObjectDeep(def)
    if (init) {
      this.now = mergeObject(this.now, init)
    }
  }

  /**
   * Compare the previous config with the current config and emit changed paths.
   */
  private emitChangesFrom(prev: Full) {
    const changed = compareObject(prev, this.now) as Set<Keys>
    if (changed.size) {
      this.event.emit('update', changed, this.now)
    }
  }

  /**
   * Deep-merge a partial config object into the current config.
   */
  merge(target: Init) {
    if (!target) {
      return
    }

    const prev = this.now
    this.now = mergeObject(cloneObjectDeep(prev), target)
    this.emitChangesFrom(prev)
  }

  /**
   * Modify the current config through a callback and emit changed paths.
   */
  modify(fn: (config: Full) => void) {
    const prev = cloneObjectDeep(this.now)
    fn(this.now)
    this.emitChangesFrom(prev)
  }

  /**
   * Restore every value to its default and emit update before reset.
   */
  reset() {
    const prev = this.now
    this.now = cloneObjectDeep(this.def)
    this.emitChangesFrom(prev)
    this.event.emit('reset', this.now)
  }

  /**
   * Return the current config.
   */
  get current() {
    return this.now
  }
}
