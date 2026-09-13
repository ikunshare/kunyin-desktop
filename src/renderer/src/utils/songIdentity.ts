/** 原样展示已保存的字段，不推测平台未提供的标识。 */
import { PLATFORM_NAMES, type MusicItem } from '@common'
export interface SongInfoField {
  key: string
  label: string
  value: string
  copy?: string
  hint?: string
}
export interface SongInfoGroup {
  title: string
  fields: SongInfoField[]
}
export function buildSongInfoGroups(item: MusicItem): SongInfoGroup[] {
  const fields: SongInfoField[] = []
  function walk(value: unknown, path: string): void {
    if (value == null || value === '') return
    if (typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) walk(child, path ? `${path}.${key}` : key)
    } else {
      // 保留零值、false 和不同字段中的相同值，避免复制时遗漏原始数据。
      fields.push({ key: path, label: path, value: String(value) })
    }
  }
  walk(item, '')
  return [{ title: `${PLATFORM_NAMES[item.type] ?? item.type} · 现有歌曲字段`, fields }]
}
export function quickCopyFields(item: MusicItem): SongInfoField[] {
  return buildSongInfoGroups(item)[0]
    .fields.filter((f) => /id|mid|hash|album/i.test(f.key))
    .slice(0, 10)
}
export function buildSongInfoText(item: MusicItem): string {
  return buildSongInfoGroups(item)
    .map((g) => `【${g.title}】\n${g.fields.map((f) => `${f.key}: ${f.value}`).join('\n')}`)
    .join('\n\n')
}
/** 完整的已保存 MusicItem（不是平台原始响应），JSON 保留空值与零值。 */
export function buildSongInfoJson(item: MusicItem): string {
  return JSON.stringify(item, null, 2)
}
