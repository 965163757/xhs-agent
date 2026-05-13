export const BEIJING_TIME_ZONE = 'Asia/Shanghai'

function parseDate(value?: string | number | Date | null) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export function formatBeijingDateTime(
  value?: string | number | Date | null,
  options: Intl.DateTimeFormatOptions = {},
) {
  const date = parseDate(value)
  if (!date) return '—'
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: BEIJING_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    ...options,
  }).format(date)
}

export function formatBeijingDate(
  value?: string | number | Date | null,
  options: Intl.DateTimeFormatOptions = {},
) {
  const date = parseDate(value)
  if (!date) return '—'
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: BEIJING_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    ...options,
  }).format(date)
}

export function getBeijingTodayParts() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BEIJING_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())

  const get = (type: string) => Number(parts.find(p => p.type === type)?.value || 0)
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
  }
}
