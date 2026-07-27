import { XmlNodeType } from './constant'

export interface XmlAttribute {
  name: string
  value: string
  prefix: string
  local: string
}

export interface XmlElement {
  type: XmlNodeType.Element
  tag: string
  prefix: string
  local: string
  attributes: XmlAttribute[]
  children: XmlNode[]
  parent: XmlElement | null
}

export interface XmlText {
  type: XmlNodeType.Text
  content: string
  parent: XmlElement | null
}

export interface XmlCdata {
  type: XmlNodeType.Cdata
  content: string
  parent: XmlElement | null
}

export interface XmlComment {
  type: XmlNodeType.Comment
  content: string
  parent: XmlElement | null
}

export type XmlNode = XmlElement | XmlText | XmlCdata | XmlComment
