export * from './space'

export * from './replace'

export const checkTextIsValid = (content: any): content is string => {
  return typeof content === 'string' && content.trim().length !== 0
}
