export const createHash = (str: string): string => {
  let hash = 0

  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0
  }

  return (hash >>> 0).toString(16).padStart(8, '0').toUpperCase()
}

/**
 * Whether a colon separates a clock time like 10:30 rather than an agent name.
 *
 * Inspects only the digits hugging the colon: a one or two digit hour (0-24) ending `before` and a one or two digit minute (0-60) starting `after`.
 */
export const isClockTimeColon = (before: string, after: string): boolean => {
  const hour = /(\d+)$/.exec(before)?.[1]
  const minute = /^(\d+)/.exec(after)?.[1]

  if (hour === undefined || minute === undefined) {
    return false
  }

  return hour.length <= 2 && Number(hour) <= 24 && minute.length <= 2 && Number(minute) <= 60
}
