import { DeepReadonly } from '../types'

const checkValid = (content: any) => {
  return content !== void 0 && content !== null && typeof content === 'object'
}

const freezeObject = (obj: any, already?: WeakSet<object>): any => {
  if (!checkValid(obj)) return obj

  if (already) {
    if (already.has(obj)) return obj
    already.add(obj)
  }

  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      const value = obj[i]
      if (checkValid(value)) {
        freezeObject(value, already)
      }
    }
    Object.freeze(obj)
    return obj
  }

  if (obj instanceof Map) {
    for (const [key, value] of obj.entries()) {
      if (checkValid(key)) {
        freezeObject(key, already)
      }
      if (checkValid(value)) {
        freezeObject(value, already)
      }
    }
    Object.freeze(obj)
    return obj
  }

  if (obj instanceof Set) {
    for (const value of obj.values()) {
      if (checkValid(value)) {
        freezeObject(value, already)
      }
    }
    Object.freeze(obj)
    return obj
  }

  // others
  const props = [...Object.getOwnPropertyNames(obj), ...Object.getOwnPropertySymbols(obj)]

  for (const key of props) {
    try {
      const value = (obj as any)[key]
      if (checkValid(value)) {
        freezeObject(value, already)
      }
    } catch {
      // pass
    }
  }

  Object.freeze(obj)
  return obj
}

export const freezeObjectDeep = <T>(root: T): DeepReadonly<T> => {
  const already = new WeakSet<object>()
  return freezeObject(root, already) as DeepReadonly<T>
}
