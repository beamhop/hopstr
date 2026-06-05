// NIP-02: follow list (kind 3) — `p` tags of followed pubkeys, replaceable.
import type { EventTemplate, NostrEvent } from '@nostragent/core'

export interface Follow {
  pubkey: string
  relay?: string
  petname?: string
}

/** Build a kind-3 follow list from a set of follows. */
export function followList(follows: Follow[]): EventTemplate {
  return {
    kind: 3,
    content: '',
    tags: follows.map((f) => {
      const tag = ['p', f.pubkey]
      // relay/petname are positional, so only append when present (petname needs relay slot)
      if (f.relay || f.petname) tag.push(f.relay ?? '')
      if (f.petname) tag.push(f.petname)
      return tag
    }),
  }
}

/** Parse a kind-3 event into its follows. */
export function parseFollowList(event: NostrEvent): Follow[] {
  return event.tags
    .filter((t) => t[0] === 'p' && t[1])
    .map((t) => {
      const f: Follow = { pubkey: t[1]! }
      if (t[2]) f.relay = t[2]
      if (t[3]) f.petname = t[3]
      return f
    })
}

/** Just the followed pubkeys. */
export function followedPubkeys(event: NostrEvent): string[] {
  return event.tags.filter((t) => t[0] === 'p' && t[1]).map((t) => t[1]!)
}
