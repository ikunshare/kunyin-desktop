export class Event<M extends { [K in keyof M]: (...args: any[]) => any }> {
  private currentListeners: {
    [K in keyof M]?: Array<M[K]>
  } = {}

  add<K extends keyof M>(event: K, listener: M[K]): void {
    let callbacks = this.currentListeners[event]
    if (!callbacks) {
      callbacks = this.currentListeners[event] = []
    }
    callbacks.push(listener)
  }

  remove<K extends keyof M>(event: K, listener: M[K]): void {
    const callbacks = this.currentListeners[event]
    if (!callbacks) {
      return
    }

    const index = callbacks.indexOf(listener)
    if (index !== -1) {
      callbacks.splice(index, 1)
    }
  }

  emit<K extends keyof M>(event: K, ...args: Parameters<M[K]>): void {
    const callbacks = this.currentListeners[event]
    if (!callbacks?.length) {
      return
    }

    for (const callback of [...callbacks]) {
      const fn = callback as (...args: Parameters<M[K]>) => ReturnType<M[K]>
      // Isolate listeners: one throwing must not stop the rest of the chain.
      try {
        fn(...args)
      } catch (error) {
        console.error(error)
      }
    }
  }

  clear(): void {
    this.currentListeners = {}
  }
}
