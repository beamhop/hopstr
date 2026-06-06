// NIP-65 relay lists (kind 10002): an author's advertised read/write relays.
import type { NostrEvent } from '@hopstr/core'

export interface RelayListEntry {
  url: string
  read: boolean
  write: boolean
}

/** Normalize a relay URL for comparison (lowercase host, single trailing slash off). */
export function normalizeRelayUrl(url: string): string {
  try {
    const u = new URL(url)
    u.hash = ''
    let s = u.toString()
    if (s.endsWith('/')) s = s.slice(0, -1)
    return s
  } catch {
    return url.replace(/\/+$/, '')
  }
}

/**
 * Parse a kind-10002 event into relay entries. An `r` tag is
 * `["r", url]` (both read+write) or `["r", url, "read"|"write"]`.
 */
export function parseRelayList(event: NostrEvent): RelayListEntry[] {
  if (event.kind !== 10002) throw new Error('not a kind-10002 relay list')
  const out: RelayListEntry[] = []
  for (const tag of event.tags) {
    if (tag[0] !== 'r' || !tag[1]) continue
    const marker = tag[2]
    out.push({
      url: normalizeRelayUrl(tag[1]),
      read: marker !== 'write',
      write: marker !== 'read',
    })
  }
  return out
}

export const readRelays = (entries: RelayListEntry[]): string[] => entries.filter((e) => e.read).map((e) => e.url)
export const writeRelays = (entries: RelayListEntry[]): string[] => entries.filter((e) => e.write).map((e) => e.url)
