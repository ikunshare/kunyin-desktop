export const extractCreator = (line: string): [string, string] | null => {
  if (!line) {
    return null
  }

  const text = line.trim()
  if (!text) {
    return null
  }

  const match = text.match(/^(.+?)\s*[:：]\s*(.*)$/)
  if (!match) {
    return null
  }

  const role = match[1].trim()
  const name = match[2].trim()

  if (!role) {
    return null
  }

  return [role, name]
}

export const splitNameWithRule = (name: string, rule: string | RegExp) => {
  return name
    .split(rule)
    .map((item) => item.trim())
    .filter((item) => !!item)
}
