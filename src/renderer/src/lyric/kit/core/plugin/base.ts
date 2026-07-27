import { ConfigManager } from '../../utils'

export enum PluginStage {
  Setup,
  Pre,
  Process,
  Transform,
  Post,
  Cleanup
}

export abstract class BaseContext {
  abstract params: any

  abstract result: any
}

export abstract class BasePlugin<Context = BaseContext> {
  abstract get id(): string

  abstract get stage(): PluginStage

  get name(): string {
    return ''
  }

  get priority(): number {
    return 100
  }

  get format(): string {
    return ''
  }

  // [vendor patch] 第三个泛型显式放开为 any。
  // 上游按包分别编译，跨包引用走生成的 .d.ts，那里 ConfigManager<any, any> 的 Keys 被放宽成
  // string；而内嵌后是源码直连，TS 会算出真实的 Keys 字面量联合，
  // ConfigManagerEventMap 里 `Set<Keys>` 处于逆变位，各插件的窄 Keys 便无法赋给 BasePlugin。
  // 留空第三参会退化成 NestedKeys<any>，故显式写 any。仅影响类型，运行时无差异。
  readonly config?: ConfigManager<any, any, any>

  abstract check(ctx: Context): boolean

  abstract exec(ctx: Context): void
}
