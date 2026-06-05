// NIP-01 filters and a local matcher (used by the store and for client-side checks).
import type { NostrEvent } from './event.ts'

/**
 * A relay filter. Array fields are OR'd within, all fields AND'd together.
 * `#<single-letter>` tag filters are open-ended (`#e`, `#p`, `#t`, …).
 */
export interface Filter {
  ids?: string[]
  authors?: string[]
  kinds?: number[]
  since?: number
  until?: number
  limit?: number
  search?: string
  [tagQuery: `#${string}`]: string[] | undefined
}

/** Does an event satisfy a single filter? (search is relay-side, ignored here.) */
export function matchFilter(filter: Filter, event: NostrEvent): boolean {
  if (filter.ids && !filter.ids.includes(event.id)) return false
  if (filter.authors && !filter.authors.includes(event.pubkey)) return false
  if (filter.kinds && !filter.kinds.includes(event.kind)) return false
  if (filter.since !== undefined && event.created_at < filter.since) return false
  if (filter.until !== undefined && event.created_at > filter.until) return false
  for (const key in filter) {
    if (key[0] !== '#' || key.length !== 2) continue
    const wanted = filter[key as `#${string}`]
    if (!wanted) continue
    const letter = key[1]
    const present = event.tags.some((t) => t[0] === letter && t[1] !== undefined && wanted.includes(t[1]))
    if (!present) return false
  }
  return true
}

/** Does an event satisfy ANY of the filters? (relay semantics for a REQ.) */
export function matchFilters(filters: Filter[], event: NostrEvent): boolean {
  return filters.some((f) => matchFilter(f, event))
}
