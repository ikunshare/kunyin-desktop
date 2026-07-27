import { Xml } from '../../utils'

import { parseTime } from '../../utils'

export type ElementGroups = Map<string, Xml.XmlElement[]>

export const collectElementsByLocalName = (
  root: Xml.XmlElement,
  names: string[]
): ElementGroups => {
  const wanted = new Set(names)
  const result: ElementGroups = new Map()
  const stack: Xml.XmlNode[] = [root]

  while (stack.length > 0) {
    const node = stack.pop()!
    if (node.type !== Xml.XmlNodeType.Element) {
      continue
    }

    if (wanted.has(node.local)) {
      const list = result.get(node.local)
      if (list) {
        list.push(node)
      } else {
        result.set(node.local, [node])
      }
    }

    for (let i = node.children.length - 1; i >= 0; i--) {
      stack.push(node.children[i])
    }
  }

  return result
}

export const findElementsByLocalName = (
  root: Xml.XmlElement,
  local: string,
  first: boolean = false
) => {
  const stack: Xml.XmlNode[] = [root]
  const result: Xml.XmlElement[] = []

  while (stack.length > 0) {
    const node = stack.pop()!
    if (node.type === Xml.XmlNodeType.Element) {
      if (node.local === local) {
        if (first) {
          return [node]
        } else {
          result.push(node)
        }
      }
      for (let i = node.children.length - 1; i >= 0; i--) {
        stack.push(node.children[i])
      }
    }
  }

  return result
}

export const getChildElementsByLocalName = (element: Xml.XmlElement, name: string) => {
  const result: Xml.XmlElement[] = []
  for (const child of element.children) {
    if (child.type === Xml.XmlNodeType.Element && child.local === name) {
      result.push(child)
    }
  }
  return result
}

export const hasChildElementByLocalName = (element: Xml.XmlElement, name: string) => {
  for (const child of element.children) {
    if (child.type === Xml.XmlNodeType.Element && child.local === name) {
      return true
    }
  }
  return false
}

export const getAttributeByName = (
  element: Xml.XmlElement,
  name: string,
  local: boolean = false
) => {
  for (let i = 0; i < element.attributes.length; i++) {
    const item = element.attributes[i]
    if (local) {
      if (item.local === name) {
        return item.value
      }
    } else {
      if (item.name === name) {
        return item.value
      }
    }
  }
  return void 0
}

export const getTextContent = (node: Xml.XmlNode) => {
  if (node.type !== Xml.XmlNodeType.Element) {
    return node.content
  }
  let result = ''
  for (const child of node.children) {
    result += getTextContent(child)
  }
  return result
}

export const parseSpanTime = (element: Xml.XmlElement): { start: number; end: number } | null => {
  const rawBegin = getAttributeByName(element, 'begin', true)
  const rawEnd = getAttributeByName(element, 'end', true)
  if (!rawBegin || !rawEnd) {
    return null
  }
  const start = parseTime(rawBegin)
  const end = parseTime(rawEnd)
  if (start === null || end === null) {
    return null
  }
  return { start, end }
}
