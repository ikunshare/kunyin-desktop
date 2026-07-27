type SkipDeepBuiltins =
  RegExp | Date | Error | Blob | File | URL | ArrayBuffer | SharedArrayBuffer | DataView

type SkipDeepPrimitives = string | number | boolean | bigint | symbol

export type DeepRequired<T> = T extends (...args: any[]) => any
  ? T
  : T extends SkipDeepBuiltins
    ? T
    : T extends SkipDeepPrimitives
      ? T
      : T extends Promise<infer U>
        ? Promise<DeepRequired<U & {}>>
        : T extends Map<infer K, infer V>
          ? Map<DeepRequired<K & {}>, DeepRequired<V & {}>>
          : T extends Set<infer U>
            ? Set<DeepRequired<U & {}>>
            : T extends readonly any[]
              ? { [K in keyof T]-?: DeepRequired<T[K] & {}> }
              : T extends object
                ? { [K in keyof T]-?: DeepRequired<T[K] & {}> }
                : T & {}

export type DeepPartial<T> = T extends (...args: any[]) => any
  ? T
  : T extends SkipDeepBuiltins
    ? T
    : T extends SkipDeepPrimitives
      ? T
      : T extends Map<infer K, infer V>
        ? Map<DeepPartial<K>, DeepPartial<V>>
        : T extends Set<infer U>
          ? Set<DeepPartial<U>>
          : T extends readonly any[]
            ? { [K in keyof T]?: DeepPartial<T[K]> }
            : T extends object
              ? { [K in keyof T]?: DeepPartial<T[K]> }
              : T

export type DeepReadonly<T> = T extends (...args: any[]) => any
  ? T
  : T extends SkipDeepBuiltins
    ? Readonly<T>
    : T extends SkipDeepPrimitives
      ? T
      : T extends Map<infer K, infer V>
        ? ReadonlyMap<DeepReadonly<K>, DeepReadonly<V>>
        : T extends Set<infer U>
          ? ReadonlySet<DeepReadonly<U>>
          : T extends readonly any[]
            ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
            : T extends object
              ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
              : T
