// NIP-09: event deletion request (kind 5) — references events/addresses to delete.
import { addressOf, type EventTemplate, type NostrEvent } from '@nostragent/core'

/** Build a kind-5 deletion for one or more event ids (with an optional reason). */
export function deleteEvents(ids: string[], reason = ''): EventTemplate {
  return { kind: 5, content: reason, tags: ids.map((id) => ['e', id]) }
}

/** Build a kind-5 deletion for addressable coordinates (`kind:pubkey:d`). */
export function deleteAddresses(coords: string[], reason = ''): EventTemplate {
  return { kind: 5, content: reason, tags: coords.map((a) => ['a', a]) }
}

/** Build a deletion targeting full events (derives e- or a-tags by kind). */
export function deleteEventObjects(events: NostrEvent[], reason = ''): EventTemplate {
  const tags = events.flatMap((e) =>
    e.kind >= 30000 && e.kind < 40000 ? [['a', addressOf(e)], ['e', e.id]] : [['e', e.id]],
  )
  return { kind: 5, content: reason, tags }
}

export interface DeletionTargets {
  ids: string[]
  addresses: string[]
  reason: string
}

/** Parse a kind-5 deletion into its targets. */
export function parseDeletion(event: NostrEvent): DeletionTargets {
  return {
    ids: event.tags.filter((t) => t[0] === 'e' && t[1]).map((t) => t[1]!),
    addresses: event.tags.filter((t) => t[0] === 'a' && t[1]).map((t) => t[1]!),
    reason: event.content,
  }
}
