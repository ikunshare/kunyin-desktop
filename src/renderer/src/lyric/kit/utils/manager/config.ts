import type { NestedKeys, PathValue } from '../types'

import { Event } from '../event'

import { mergeObject, cloneObjectDeep, compareObject, getObject, setObject } from '../object'

export interface ConfigManagerEventMap<Full, Keys> {
  update: (changeKeys: Set<Keys>, config: Full) => void
  reset: (config: Full) => void
}

/**
 * Flat patch keyed by dot-paths (`a.b.c`); each value is typed to the value living at that path.
 */
export type ConfigSetPayload<Full, Keys> = Partial<{
  [K in Extract<Keys, string>]: PathValue<Full, K>
}>

export class ConfigManager<Full, Init, Keys = NestedKeys<Full>> {
  readonly event = new Event<ConfigManagerEventMap<Full, Keys>>()

  private def: Full
  private now: Full

  constructor(def: Full, init?: Init) {
    this.def = def
    this.now = cloneObjectDeep(def)
    if (init) {
      this.now = mergeObject(this.now, init)
    }
  }

  /**
   * Emit an update with the changed paths, diffing only when someone is actually listening.
   */
  private emitUpdate(prev: Full) {
    if (!this.event.has('update')) {
      return
    }

    const changed = compareObject(prev, this.now) as Set<Keys>
    if (changed.size) {
      this.event.emit('update', changed, this.now)
    }
  }

  /**
   * Deep-merge a (partial) config object into the current one. To write by dot-path, use `set` instead.
   * Emits `update` with the changed paths, only when something actually changed.
   */
  update(target: Init) {
    if (!target) {
      return
    }

    const prev = this.now
    this.now = mergeObject(cloneObjectDeep(prev), target)

    this.emitUpdate(prev)
  }

  /**
   * Reset to defaults and merge a (partial) patch in one step, emitting at most one `update`.
   *
   * Equivalent to `reset` then `update` but avoids the intermediate notification.
   */
  apply(target?: Init) {
    const prev = this.now

    let next = cloneObjectDeep(this.def)
    if (target) {
      next = mergeObject(next, target)
    }
    this.now = next

    this.emitUpdate(prev)
  }

  /**
   * Restore every value back to the defaults. Emits `update` (the changed paths) and then `reset`.
   */
  reset() {
    const prev = this.now
    this.now = cloneObjectDeep(this.def)

    this.emitUpdate(prev)

    this.event.emit('reset', this.now)
  }

  /**
   * Read a single value by dot-path. To read the whole config, use `current`.
   */
  get<K extends Extract<Keys, string>>(key: K): PathValue<Full, K> {
    return getObject(this.now, key) as PathValue<Full, K>
  }

  /**
   * Write by dot-path. Accepts a single `key, value` pair or a flat patch of several paths at once.
   * Mirrors `update`: clone, apply, diff, and only emit `update` when something actually changed.
   */
  set<K extends Extract<Keys, string>>(key: K, value: PathValue<Full, K>): void
  set(values: ConfigSetPayload<Full, Keys>): void
  set(input: Extract<Keys, string> | ConfigSetPayload<Full, Keys>, value?: unknown) {
    if (!input) {
      return
    }

    const prev = this.now
    const next = cloneObjectDeep(prev)
    const target = next as Record<string, unknown>

    if (typeof input === 'string') {
      setObject(target, input, value)
    } else {
      for (const key of Object.keys(input)) {
        setObject(target, key, (input as Record<string, unknown>)[key])
      }
    }

    this.now = next

    this.emitUpdate(prev)
  }

  /**
   * The whole current config. To read a single value, use `get(key)`.
   */
  get current() {
    return this.now
  }
}
