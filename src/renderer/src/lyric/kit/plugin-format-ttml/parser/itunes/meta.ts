import { Lyric } from '../../../lyric'
import { Xml } from '../../../utils'

import { getChildElementsByLocalName, getAttributeByName, getTextContent } from '../../utils'

export const applyItunesMetas = (meta: Lyric.Common.Meta, songwriters: Xml.XmlElement[]) => {
  const names: string[] = []
  for (const element of songwriters) {
    const name = getTextContent(element).trim()
    if (name) {
      names.push(name)
    }
  }

  if (!names.length) {
    return
  }

  meta.credits.push(
    Lyric.Common.makeMetaCredit({
      role: 'songWriter',
      names: names.map((name) => Lyric.Common.makeMetaText({ content: name }))
    })
  )
}

const resolveAgentType = (type: string): Lyric.Common.AgentType => {
  switch (type) {
    case 'person':
      return Lyric.Common.AgentType.PERSON
    case 'group':
      return Lyric.Common.AgentType.GROUP
    case 'other':
      return Lyric.Common.AgentType.OTHER
    default:
      return Lyric.Common.AgentType.UNKNOWN
  }
}

const parseAgentNames = (element: Xml.XmlElement): string[] => {
  const result: string[] = []
  for (const child of getChildElementsByLocalName(element, 'name')) {
    const name = getTextContent(child).trim()
    if (name) {
      result.push(name)
    }
  }
  return result
}

const parseAgent = (element: Xml.XmlElement) => {
  const type = getAttributeByName(element, 'type', true)
  const id = getAttributeByName(element, 'id', true)

  if (!type || !id) {
    return null
  }

  return Lyric.Common.makeAgentItem({
    id,
    type: resolveAgentType(type),
    names: parseAgentNames(element)
  })
}

export const parseAgents = (agents: Xml.XmlElement[]): Lyric.Common.AgentItem[] => {
  const result: Lyric.Common.AgentItem[] = []

  for (const element of agents) {
    const item = parseAgent(element)
    if (item) {
      result.push(item)
    }
  }

  return result
}
