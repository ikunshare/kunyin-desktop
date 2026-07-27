export * from './deep'
export * from './key'

export type ValueOf<T extends object> = T[keyof T]
