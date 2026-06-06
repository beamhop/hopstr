// NIP-18: reposts (kind 6 for kind-1 notes, kind 16 for generic) and quote reposts.
import { type EventTemplate, type NostrEvent } from '@hopstr/core'

/** Repost a kind-1 note (kind 6). content carries the stringified original (optional). */
export function repost(event: NostrEvent, relay = ''): EventTemplate {
  return {
    kind: 6,
    content: JSON.stringify(event),
    tags: [
      ['e', event.id, relay],
      ['p', event.pubkey],
    ],
  }
}

/** Generic repost of any non-kind-1 event (kind 16, with a `k` kind tag). */
export function genericRepost(event: NostrEvent, relay = ''): EventTemplate {
  return {
    kind: 16,
    content: JSON.stringify(event),
    tags: [
      ['e', event.id, relay],
      ['p', event.pubkey],
      ['k', String(event.kind)],
    ],
  }
}

/** A quote repost: a normal kind-1 note that references the quoted event via `q`. */
export function quote(content: string, quoted: NostrEvent, relay = ''): EventTemplate {
  return {
    kind: 1,
    content,
    tags: [
      ['q', quoted.id, relay, quoted.pubkey],
      ['p', quoted.pubkey],
    ],
  }
}

/** Parse the reposted event id/author out of a kind-6/16 event. */
export function parseRepost(event: NostrEvent): { id?: string; pubkey?: string; embedded?: NostrEvent } {
  const e = event.tags.find((t) => t[0] === 'e')?.[1]
  const p = event.tags.find((t) => t[0] === 'p')?.[1]
  let embedded: NostrEvent | undefined
  if (event.content) {
    try {
      embedded = JSON.parse(event.content) as NostrEvent
    } catch {
      // content wasn't an embedded event
    }
  }
  const out: { id?: string; pubkey?: string; embedded?: NostrEvent } = {}
  if (e) out.id = e
  if (p) out.pubkey = p
  if (embedded) out.embedded = embedded
  return out
}
