type SkipDeepBuiltins =
  RegExp | Date | Error | Blob | File | URL | ArrayBuffer | SharedArrayBuffer | DataView

export type DeepRequired<T> = T extends (...args: any[]) => any
  ? T
  : T extends SkipDeepBuiltins
    ? NonNullable<T>
    : T extends Promise<infer U>
      ? Promise<DeepRequired<NonNullable<U>>>
      : T extends readonly any[]
        ? { [K in keyof T]-?: DeepRequired<NonNullable<T[K]>> }
        : T extends Array<infer U>
          ? Array<DeepRequired<NonNullable<U>>>
          : T extends Map<infer K, infer V>
            ? Map<DeepRequired<NonNullable<K>>, DeepRequired<NonNullable<V>>>
            : T extends Set<infer U>
              ? Set<DeepRequired<NonNullable<U>>>
              : T extends object
                ? { [K in keyof T]-?: DeepRequired<NonNullable<T[K]>> }
                : NonNullable<T>

export type DeepPartial<T> = T extends (...args: any[]) => any
  ? T
  : T extends Map<infer K, infer V>
    ? Map<DeepPartial<K>, DeepPartial<V>>
    : T extends Set<infer U>
      ? Set<DeepPartial<U>>
      : T extends object
        ? { [K in keyof T]?: DeepPartial<T[K]> }
        : T

export type DeepReadonly<T> = T extends (...args: any[]) => any
  ? T
  : T extends Array<infer U>
    ? ReadonlyArray<DeepReadonly<U>>
    : T extends Map<infer K, infer V>
      ? ReadonlyMap<DeepReadonly<K>, DeepReadonly<V>>
      : T extends Set<infer U>
        ? ReadonlySet<DeepReadonly<U>>
        : T extends object
          ? { readonly [P in keyof T]: DeepReadonly<T[P]> }
          : T
