/** bg-render 的通用接口（AMLL core src/interfaces.ts 精简移植） */

export interface Disposable {
  dispose(): void
}

export interface HasElement {
  getElement(): HTMLElement
}
