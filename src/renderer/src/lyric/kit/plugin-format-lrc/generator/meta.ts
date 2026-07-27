import { Lyric } from '../../lyric'
import { formatTime } from '../../utils'

const renderItem = (key: string, content: string) => {
  return `[${key}:${content}]`
}

export const exportMeta = (info: Lyric.Parsed.Info) => {
  const result: string[] = []

  const meta = info.meta
  if (!meta) {
    return result
  }

  if (meta.offset) {
    result.push(renderItem('offset', meta.offset.toString()))
  }
  for (const title of meta.titles) {
    result.push(renderItem('ti', title.content))
  }
  for (const artist of meta.artists) {
    result.push(renderItem('ar', artist.content))
  }
  for (const album of meta.albums) {
    result.push(renderItem('al', album.content))
  }
  if (meta.duration) {
    result.push(renderItem('length', formatTime(meta.duration)))
  }

  return result
}
