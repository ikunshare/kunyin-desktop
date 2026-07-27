type IsPlainObject<T> = T extends object
  ? T extends Date | RegExp | Map<any, any> | Set<any> | Function | readonly any[]
    ? false
    : T extends { [key: string]: any }
      ? true
      : false
  : false

type SplitKey<
  S extends string,
  D extends string = '.',
  Result extends string[] = []
> = S extends `${infer Head}${D}${infer Rest}`
  ? SplitKey<Rest, D, [...Result, Head]>
  : S extends ''
    ? Result
    : [...Result, S]

type PathValueByKeys<T, Keys extends readonly string[]> = Keys extends [infer Head, ...infer Tail]
  ? Head extends keyof T
    ? Tail extends []
      ? T[Head]
      : T[Head] extends null | undefined
        ? undefined
        : PathValueByKeys<T[Head], Extract<Tail, string[]>>
    : undefined
  : T

type JoinKey<K extends string, P extends string> = P extends '' ? K : `${K}.${P}`

export type NestedKeys<T> = T extends object
  ? {
      [K in keyof T & string]: IsPlainObject<NonNullable<T[K]>> extends true
        ? K | JoinKey<K, Extract<NestedKeys<NonNullable<T[K]>>, string>>
        : K
    }[keyof T & string]
  : never

export type PathValue<T, K extends string> = PathValueByKeys<T, SplitKey<K>>
