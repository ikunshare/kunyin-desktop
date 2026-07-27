export const removeTextSpaceAll = (content: string) => {
  return content.replaceAll(/\s+/g, '').trim()
}

export const removeTextSpaceToOne = (content: string) => {
  return content.replaceAll(/[ ]{2,}/g, ' ').trim()
}
