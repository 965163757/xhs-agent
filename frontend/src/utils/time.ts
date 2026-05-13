export const BEIJING_TIME_ZONE = 'Asia/Shanghai'
const BEIJING_OFFSET = '+08:00'

function normalizeDateString(value: string) {
  const raw = value.trim()
  if (!raw) return raw

  // Already timezone-aware: ISO `Z` or a numeric offset.
  if (/(z|[+-]\d{2}:?\d{2})$/i.test(raw)) return raw

  // Backend historical rows may look like:
  //   2026-05-13 16:30:00
  //   2026-05-13T16:30:00.123456
  // Treat these as Beijing wall-clock time instead of browser-local time.
  if (/^\d{4}-\d{2}-\d{2}([T\s]\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?)?$/.test(raw)) {
    const isoLike = raw.includes('T') ? raw : raw.replace(' ', 'T')
    const withTime = /^\d{4}-\d{2}-\d{2}$/.test(isoLike) ? `${isoLike}T00:00:00` : isoLike
    return `${withTime}${BEIJING_OFFSET}`
  }

  return raw
}

export function parseAppDate(value?: string | number | Date | null) {
  if (!value) return null
  const input = typeof value === 'string' ? normalizeDateString(value) : value
  const date = value instanceof Date ? value : new Date(input)
  return Number.isNaN(date.getTime()) ? null : date
}

export function appDateTimestamp(value?: string | number | Date | null) {
  return parseAppDate(value)?.getTime() ?? 0
}

export function formatBeijingDateTime(
  value?: string | number | Date | null,
  options: Intl.DateTimeFormatOptions = {},
) {
  const date = parseAppDate(value)
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
  const date = parseAppDate(value)
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
