const TIME_REGEXP = /^(?:(?:(\d+):)?(\d+):)?(\d+)(?:\.(\d+))?$/u

const parseMilliSecond = (content: string) => {
  return content.padEnd(3, '0').slice(0, 3)
}

/**
 * parse time
 * support format:
 *    - hh:mm:ss
 *    - hh:mm:ss.SSS
 *    - mm:ss
 *    - mm:ss.SSS
 *    - ss.SSS
 *    - SSS
 * @param content time
 * @example 1:14:514
 * @example 14:514
 * @example 14.514
 * @example 123
 */
export const parseTime = (content: string) => {
  const trimmed = content?.trim()
  if (!trimmed) {
    return null
  }

  // .SSS
  if (trimmed.startsWith('.')) {
    const value = trimmed.slice(1)
    if (!/^\d+$/.test(value)) {
      return null
    }
    return parseInt(parseMilliSecond(value), 10)
  }

  // SSS
  if (/^\d+$/.test(trimmed)) {
    return parseInt(trimmed, 10)
  }

  const match = trimmed.match(TIME_REGEXP)
  if (!match) {
    return null
  }

  const hour = parseInt(match[1], 10) || 0
  const minute = parseInt(match[2], 10) || 0
  const second = parseInt(match[3], 10) || 0
  const milliSecond = parseInt(parseMilliSecond(match[4] || '0'), 10) || 0

  return ((hour * 60 + minute) * 60 + second) * 1000 + milliSecond
}

/**
 * export time
 * support flag:
 *    - hh
 *    - mm
 *    - ss
 *    - SSS
 * @param time timestamp
 * @param format e.g mm:ss.SSS
 */
export const formatTime = (time: number | Date, format: string = 'mm:ss.SSS') => {
  if (time instanceof Date) {
    time = time.getTime()
  }

  if (!Number.isFinite(time) || time < 0) {
    return format.replace(/h+/g, '0').replace(/m+/g, '0').replace(/s+/g, '0').replace(/S+/g, '0')
  }

  const totalSeconds = Math.floor(time / 1000)
  const milliSeconds = time % 1000

  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  const padNumber = (num: number, length: number) => num.toString().padStart(length, '0')

  let result = format

  if (result.includes('hh')) {
    result = result.replace(/hh/g, padNumber(hours, 2))
  } else if (result.includes('h')) {
    result = result.replace(/h/g, hours.toString())
  }

  // Handle minutes - check for mm first, then m
  // If format doesn't include hours, include hours in minutes
  const totalMinutes = !format.includes('h') ? hours * 60 + minutes : minutes
  if (result.includes('mm')) {
    result = result.replace(/mm/g, padNumber(totalMinutes, 2))
  } else if (result.includes('m')) {
    result = result.replace(/m/g, totalMinutes.toString())
  }

  // Handle seconds - check for ss first, then s
  if (result.includes('ss')) {
    result = result.replace(/ss/g, padNumber(seconds, 2))
  } else if (result.includes('s')) {
    result = result.replace(/s/g, seconds.toString())
  }

  // Handle milliseconds - check for SSS, SS, then S
  if (result.includes('SSS')) {
    result = result.replace(/SSS/g, padNumber(milliSeconds, 3))
  } else if (result.includes('SS')) {
    result = result.replace(/SS/g, padNumber(Math.floor(milliSeconds / 10), 2))
  } else if (result.includes('S')) {
    result = result.replace(/S/g, Math.floor(milliSeconds / 100).toString())
  }

  return result
}

/**
 * check is valid time
 * @param content time, e.g. 1:14:514
 */
export const checkTime = (content: string) => {
  return parseTime(content) !== null
}
