const UNITS: Record<string, number> = {
  s: 1, sec: 1, second: 1, seconds: 1,
  m: 60, min: 60, minute: 60, minutes: 60,
  h: 3600, hr: 3600, hour: 3600, hours: 3600,
  d: 86400, day: 86400, days: 86400,
  w: 604800, week: 604800, weeks: 604800,
}

const NAMED: Record<string, () => number> = {
  'now':       () => 0,
  'today':     () => startOfDay(0),
  'yesterday': () => startOfDay(1),
  'last week': () => startOfDay(7),
  'last month':() => startOfMonth(),
}

function startOfDay(daysAgo: number): number {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return Math.floor(d.getTime() / 1000) - daysAgo * 86400
}

function startOfMonth(): number {
  const d = new Date()
  d.setDate(1)
  d.setHours(0, 0, 0, 0)
  return Math.floor(d.getTime() / 1000)
}

/**
 * Parse a human-friendly --since value into a Unix timestamp (seconds).
 * Supports:
 *   - Raw unix timestamp:    1749200000
 *   - Relative:              1h, 2d ago, 30m ago, 1w
 *   - ISO 8601:              2025-06-01, 2025-06-01T12:00:00
 *   - Natural language:      now, today, yesterday, last week, last month
 */
export function parseSince(input: string): number {
  const now = Math.floor(Date.now() / 1000)
  const s = input.trim().toLowerCase()

  // named
  for (const [key, fn] of Object.entries(NAMED)) {
    if (s === key) {
      const offset = fn()
      return offset === 0 ? now : offset
    }
  }

  // relative: e.g. "1h", "2d ago", "30m ago", "1w"
  const rel = s.replace(/\s+ago$/, '').trim()
  const relMatch = rel.match(/^(\d+)\s*([a-z]+)$/)
  if (relMatch) {
    const n = parseInt(relMatch[1]!, 10)
    const unit = UNITS[relMatch[2]!]
    if (unit !== undefined) return now - n * unit
  }

  // ISO 8601: date-only (2025-06-01) or full datetime
  if (/^\d{4}-\d{2}-\d{2}/.test(input)) {
    const ms = Date.parse(input)
    if (!isNaN(ms)) return Math.floor(ms / 1000)
  }

  // raw unix timestamp
  if (/^\d+$/.test(s)) return parseInt(s, 10)

  throw new Error(`unrecognized --since value: "${input}". Try: 1h, 2d ago, yesterday, 2025-06-01, or a unix timestamp.`)
}
