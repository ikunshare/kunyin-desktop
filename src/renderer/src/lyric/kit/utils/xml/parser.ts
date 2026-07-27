import type { XmlElement, XmlNode } from './interface'

import { XmlNodeType, CharCode, ROOT_TAG } from './constant'

export class Parser {
  private src: string = ''
  private pos: number = 0
  private len: number = 0
  private valid: boolean = true

  /**
   * Parse an xml string into a document tree.
   * Returns null when the input is not well formed, so callers can bail out.
   */
  parse(xml: string): XmlElement | null {
    this.src = xml
    this.pos = 0
    this.len = xml.length
    this.valid = true

    const root: XmlElement = {
      type: XmlNodeType.Element,
      tag: ROOT_TAG,
      prefix: '',
      local: ROOT_TAG,
      attributes: [],
      children: [],
      parent: null
    }

    if (this.len > 0 && this.src.charCodeAt(0) === 0xfeff) {
      this.pos++
    }

    this.parseContent(root)

    if (!this.valid || !this.hasElementChild(root)) {
      return null
    }
    return root
  }

  /**
   * Whether the node has at least one element child, i.e. the input parsed to real markup.
   */
  private hasElementChild(node: XmlElement): boolean {
    for (const child of node.children) {
      if (child.type === XmlNodeType.Element) {
        return true
      }
    }
    return false
  }

  private skipWhitespace(): void {
    while (this.pos < this.len && this.src.charCodeAt(this.pos) <= 32) {
      this.pos++
    }
  }

  private skipDeclaration() {
    this.pos += 2
    let depth = 1
    while (this.pos < this.len && depth > 0) {
      const ch = this.src.charCodeAt(this.pos)
      if (ch === CharCode.LessThan) depth++
      else if (ch === CharCode.GreaterThan) depth--
      this.pos++
    }
  }

  private skipProcessingInstruction(): void {
    // skip <?
    this.pos += 2
    const endIdx = this.src.indexOf('?>', this.pos)
    this.pos = endIdx === -1 ? this.len : endIdx + 2
  }

  private parseContent(parent: XmlElement): void {
    while (this.pos < this.len) {
      const nextIndex = this.src.indexOf('<', this.pos)

      if (nextIndex === -1) {
        this.parseText(parent, this.len)
        break
      }
      if (nextIndex > this.pos) {
        this.parseText(parent, nextIndex)
      }

      this.pos = nextIndex

      if (this.pos + 1 >= this.len) {
        break
      }

      const nextChar = this.src.charCodeAt(this.pos + 1)
      if (nextChar === CharCode.Slash) {
        return
      }

      if (nextChar === CharCode.Exclamation) {
        if (
          this.src.charCodeAt(this.pos + 2) === CharCode.Dash &&
          this.src.charCodeAt(this.pos + 3) === CharCode.Dash
        ) {
          this.parseComment()
        } else if (this.src.slice(this.pos + 2, this.pos + 9) === '[CDATA[') {
          this.parseCdata(parent)
        } else {
          this.skipDeclaration()
        }
      } else if (nextChar === CharCode.QuestionMark) {
        this.skipProcessingInstruction()
      } else {
        this.parseElement(parent)
      }
    }
  }

  private parseText(parent: XmlElement, end: number) {
    const raw = this.src.slice(this.pos, end)
    this.pos = end

    if (raw.length > 0) {
      const content = raw.indexOf('&') !== -1 ? this.decodeEntity(raw) : raw
      const item: XmlNode = {
        type: XmlNodeType.Text,
        content,
        parent
      }
      parent.children.push(item)
    }
  }

  private parseComment(): void {
    // skip <!--
    this.pos += 4
    const end = this.src.indexOf('-->', this.pos)
    this.pos = end === -1 ? this.len : end + 3
  }

  private parseCdata(parent: XmlElement): void {
    // skip <![CDATA[
    this.pos += 9

    const start = this.pos
    const end = this.src.indexOf(']]>', this.pos)

    this.pos = end === -1 ? this.len : end + 3

    const content = this.src.slice(start, end !== -1 ? end : this.pos)
    if (content.length > 0) {
      parent.children.push({
        type: XmlNodeType.Cdata,
        content,
        parent
      })
    }
  }

  private parseName(): string {
    const start = this.pos
    while (this.pos < this.len) {
      const ch = this.src.charCodeAt(this.pos)
      if (
        ch <= 32 ||
        ch === CharCode.GreaterThan ||
        ch === CharCode.Slash ||
        ch === CharCode.Equal
      ) {
        break
      }
      this.pos++
    }
    return this.src.slice(start, this.pos)
  }

  private parseAttributeValue() {
    const quote = this.src.charCodeAt(this.pos)

    if (quote !== CharCode.DoubleQuote && quote !== CharCode.SingleQuote) {
      // a well formed attribute value must be quoted; bare values are illegal.
      this.valid = false
      const start = this.pos
      while (this.pos < this.len) {
        const ch = this.src.charCodeAt(this.pos)
        if (ch <= 32 || ch === CharCode.GreaterThan) break
        this.pos++
      }
      const raw = this.src.slice(start, this.pos)
      return raw.indexOf('&') !== -1 ? this.decodeEntity(raw) : raw
    }

    this.pos++
    const quoteChar = quote === CharCode.DoubleQuote ? '"' : "'"
    const end = this.src.indexOf(quoteChar, this.pos)

    let raw: string
    if (end === -1) {
      raw = this.src.slice(this.pos)
      this.pos = this.len
    } else {
      raw = this.src.slice(this.pos, end)
      this.pos = end + 1
    }

    return raw.indexOf('&') !== -1 ? this.decodeEntity(raw) : raw
  }

  private parseElement(parent: XmlElement): void {
    // skip '<'
    this.pos++

    const tag = this.parseName()
    if (!tag) {
      if (this.pos < this.len && this.src.charCodeAt(this.pos) === CharCode.GreaterThan) this.pos++
      return
    }

    let prefix = ''
    let local = tag
    const colonIdx = tag.indexOf(':')
    if (colonIdx !== -1) {
      prefix = tag.slice(0, colonIdx)
      local = tag.slice(colonIdx + 1)
    }

    const element: XmlElement = {
      type: XmlNodeType.Element,
      tag,
      prefix,
      local,
      attributes: [],
      children: [],
      parent
    }

    // parse attributes and element end
    while (this.pos < this.len) {
      this.skipWhitespace()
      const ch = this.src.charCodeAt(this.pos)

      if (ch === CharCode.GreaterThan) {
        // skip '>'
        this.pos++
        this.parseContent(element)
        this.parseCloseTag(tag)
        break
      }

      if (ch === CharCode.Slash) {
        // skip '/'
        this.pos++
        if (this.pos < this.len && this.src.charCodeAt(this.pos) === CharCode.GreaterThan) {
          // skip '>'
          this.pos++
        }
        break
      }

      const attrName = this.parseName()
      if (attrName.length === 0) {
        this.pos++
        continue
      }

      this.skipWhitespace()

      let attrValue = ''
      if (this.pos < this.len && this.src.charCodeAt(this.pos) === CharCode.Equal) {
        // skip '='
        this.pos++
        this.skipWhitespace()
        attrValue = this.parseAttributeValue()
      }

      let attrPrefix = ''
      let attrLocalName = attrName
      const attrColonIdx = attrName.indexOf(':')
      if (attrColonIdx !== -1) {
        attrPrefix = attrName.slice(0, attrColonIdx)
        attrLocalName = attrName.slice(attrColonIdx + 1)
      }

      element.attributes.push({
        name: attrName,
        value: attrValue,
        prefix: attrPrefix,
        local: attrLocalName
      })
    }

    parent.children.push(element)
  }

  private parseCloseTag(expected: string): void {
    // the open tag must be paired by a matching </tag>.
    if (
      this.src.charCodeAt(this.pos) !== CharCode.LessThan ||
      this.src.charCodeAt(this.pos + 1) !== CharCode.Slash
    ) {
      this.valid = false
      return
    }

    this.pos += 2
    if (this.parseName() !== expected) {
      this.valid = false
    }

    const end = this.src.indexOf('>', this.pos)
    this.pos = end === -1 ? this.len : end + 1
  }

  private parseEntity(entity: string): string {
    switch (entity) {
      case 'lt':
        return '<'
      case 'gt':
        return '>'
      case 'amp':
        return '&'
      case 'quot':
        return '"'
      case 'apos':
        return "'"
      default:
        if (entity.charCodeAt(0) === CharCode.Hash) {
          const isHex = entity.charCodeAt(1) === CharCode.LowerX
          const codeStr = isHex ? entity.slice(2) : entity.slice(1)
          const code = parseInt(codeStr, isHex ? 16 : 10)
          if (!isNaN(code)) {
            try {
              return String.fromCodePoint(code)
            } catch (e) {
              return `&#${entity};`
            }
          }
        }
        return `&${entity};`
    }
  }

  private decodeEntity(text: string) {
    let result = ''
    let lastIndex = 0
    let current = 0
    const len = text.length

    while (current < len) {
      if (text.charCodeAt(current) === CharCode.Ampersand) {
        result += text.slice(lastIndex, current)
        const semiIdx = text.indexOf(';', current + 1)

        if (semiIdx === -1) {
          result += '&'
          lastIndex = current + 1
          current++
          continue
        }

        const entity = text.slice(current + 1, semiIdx)
        result += this.parseEntity(entity)
        current = semiIdx + 1
        lastIndex = current
      } else {
        current++
      }
    }

    if (lastIndex < len) {
      result += text.slice(lastIndex)
    }

    return result
  }
}
