import type { XmlNode, XmlElement } from './interface'

import { XmlNodeType, CharCode, ROOT_TAG } from './constant'

export interface GeneratorOptions {
  declaration?: boolean
  format?: boolean
  indentChar?: string
}

export class Generator {
  private chunks: string[] = []
  private format: boolean = false
  private indentChar: string = '  '

  generate(root: XmlElement, options: GeneratorOptions = { declaration: true }): string {
    this.chunks = []
    this.format = !!options.format
    this.indentChar = options.indentChar ?? '  '

    if (options.declaration) {
      this.chunks.push('<?xml version="1.0" encoding="UTF-8"?>')
      if (this.format) {
        this.chunks.push('\n')
      }
    }

    if (root.tag === ROOT_TAG) {
      const children = root.children
      const len = children.length
      for (let i = 0; i < len; i++) {
        this.serializeNode(children[i], 0)
      }
    } else {
      this.serializeNode(root, 0)
    }

    return this.chunks.join('')
  }

  private serializeNode(node: XmlNode, depth: number): void {
    switch (node.type) {
      case XmlNodeType.Element:
        this.serializeElement(node, depth)
        break
      case XmlNodeType.Text:
        this.chunks.push(this.escapeString(node.content, false))
        break
      case XmlNodeType.Cdata:
        this.chunks.push('<![CDATA[', node.content, ']]>')
        break
      case XmlNodeType.Comment:
        this.chunks.push('<!--', node.content, '-->')
        break
    }
  }

  private serializeElement(node: XmlElement, depth: number): void {
    if (this.format && depth > 0) {
      this.chunks.push('\n', this.indentChar.repeat(depth))
    }

    this.chunks.push('<', node.tag)

    const attributes = node.attributes
    for (let i = 0; i < attributes.length; i++) {
      const item = attributes[i]
      this.chunks.push(' ', item.name, '="', this.escapeString(item.value, true), '"')
    }

    const children = node.children
    const childLen = children.length

    if (childLen === 0) {
      this.chunks.push('/>')
    } else {
      this.chunks.push('>')

      let isOnlyText = true
      for (let i = 0; i < childLen; i++) {
        const child = children[i]
        if (child.type !== XmlNodeType.Text && child.type !== XmlNodeType.Cdata) {
          isOnlyText = false
        }
        this.serializeNode(child, depth + 1)
      }

      if (this.format && !isOnlyText) {
        this.chunks.push('\n', this.indentChar.repeat(depth))
      }

      this.chunks.push('</', node.tag, '>')
    }
  }

  private escapeString(str: string, isAttr: boolean): string {
    if (!str) return ''

    let result = ''
    let lastIndex = 0
    const len = str.length

    for (let i = 0; i < len; i++) {
      const code = str.charCodeAt(i)

      let escape = ''
      switch (code) {
        case CharCode.Ampersand:
          escape = '&amp;'
          break
        case CharCode.LessThan:
          escape = '&lt;'
          break
        case CharCode.GreaterThan:
          escape = '&gt;'
          break
        case CharCode.DoubleQuote:
          if (isAttr) {
            escape = '&quot;'
          }
          break
        case CharCode.SingleQuote:
          if (isAttr) {
            escape = '&apos;'
          }
          break
      }

      if (escape !== '') {
        if (lastIndex < i) {
          result += str.substring(lastIndex, i)
        }
        result += escape
        lastIndex = i + 1
      }
    }

    if (lastIndex === 0) {
      return str
    }

    if (lastIndex < len) {
      result += str.substring(lastIndex)
    }

    return result
  }
}
