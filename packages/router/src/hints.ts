// Relay-hint extraction: where an event/tag suggests its referenced data lives.
import { nip19, type NostrEvent } from '@hopstr/core'
import { normalizeRelayUrl } from './nip65.ts'

const isRelayUrl = (s: string | undefined): s is string => !!s && /^wss?:\/\//i.test(s)

/**
 * Pull relay hints out of an event's tags. NIP-10/18/etc. put a relay URL in
 * the 3rd position of `e` tags and `["p", pubkey, relay]`; `a` tags too.
 */
export function hintsFromTags(event: NostrEvent): string[] {
  const hints = new Set<string>()
  for (const tag of event.tags) {
    if ((tag[0] === 'e' || tag[0] === 'a' || tag[0] === 'p') && isRelayUrl(tag[2])) {
      hints.add(normalizeRelayUrl(tag[2]))
    }
  }
  return [...hints]
}

/** Pull relay hints out of a NIP-19 pointer (nevent/nprofile/naddr carry relays). */
export function hintsFromPointer(entity: string): string[] {
  try {
    const decoded = nip19.decode(entity)
    if (decoded.type === 'nevent' || decoded.type === 'nprofile' || decoded.type === 'naddr') {
      return (decoded.data.relays ?? []).filter(isRelayUrl).map(normalizeRelayUrl)
    }
  } catch {
    // not a decodable pointer
  }
  return []
}
