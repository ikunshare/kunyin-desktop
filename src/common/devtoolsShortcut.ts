export interface DiagnosticInput {
  type: string
  key: string
  code?: string
  control?: boolean
  meta?: boolean
  alt?: boolean
  shift?: boolean
  isAutoRepeat?: boolean
}
export function isDevToolsCombo(input: DiagnosticInput, mac: boolean): boolean {
  return (
    input.type === 'keyDown' &&
    !input.isAutoRepeat &&
    !input.alt &&
    !input.shift &&
    (mac ? !!input.meta && !input.control : !!input.control && !input.meta) &&
    (input.key === 'F12' || input.code === 'F12')
  )
}
