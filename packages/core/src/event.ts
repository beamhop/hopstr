// The Nostr event model (NIP-01) and the branded "how complete am I" type ladder.
import type { EventId, Pubkey, Signature } from './primitives.ts'

/** A tag is a non-empty array of strings, e.g. ["e", id, relay?, marker?]. */
export type Tag = string[]

/**
 * The minimal thing you author: a kind, tags, content. No keys, no id, no time.
 * This is what builders return and what a Signer consumes.
 */
export interface EventTemplate {
  kind: number
  tags: Tag[]
  content: string
  /** optional; a signer fills `Math.floor(Date.now()/1000)` when omitted */
  created_at?: number
}

/** An event with author + timestamp + id, but not yet signed. */
export interface UnsignedEvent {
  id: EventId
  pubkey: Pubkey
  created_at: number
  kind: number
  tags: Tag[]
  content: string
}

/**
 * A fully signed, verified event. The `sig` field plus the nominal shape mean a
 * function can require a `VerifiedEvent` and the type system guarantees it went
 * through signing — you cannot publish an unsigned object by accident.
 */
export interface NostrEvent extends UnsignedEvent {
  sig: Signature
}

/** Alias kept for readability at call sites that care about the guarantee. */
export type VerifiedEvent = NostrEvent

// ── Kind classification (NIP-01) ────────────────────────────────────────────

export type KindClass = 'regular' | 'replaceable' | 'ephemeral' | 'addressable'

/**
 * Classify a kind per NIP-01's ranges. The special cases (0 and 3 are
 * replaceable) are handled explicitly; everything else falls in a range.
 */
export function classifyKind(kind: number): KindClass {
  if (kind === 0 || kind === 3) return 'replaceable'
  if (kind >= 10000 && kind < 20000) return 'replaceable'
  if (kind >= 20000 && kind < 30000) return 'ephemeral'
  if (kind >= 30000 && kind < 40000) return 'addressable'
  return 'regular'
}

export const isReplaceable = (kind: number): boolean => classifyKind(kind) === 'replaceable'
export const isEphemeral = (kind: number): boolean => classifyKind(kind) === 'ephemeral'
export const isAddressable = (kind: number): boolean => classifyKind(kind) === 'addressable'
/** Replaceable + addressable kinds are "parameterized/replaceable": newest wins. */
export const isParameterizedReplaceable: (kind: number) => boolean = isAddressable

/**
 * The addressable/replaceable coordinate `<kind>:<pubkey>:<d>` used by `a` tags
 * and naddr. For plain replaceable kinds the `d` part is empty.
 */
export function addressOf(event: Pick<NostrEvent, 'kind' | 'pubkey' | 'tags'>): string {
  const d = isAddressable(event.kind) ? (event.tags.find((t) => t[0] === 'd')?.[1] ?? '') : ''
  return `${event.kind}:${event.pubkey}:${d}`
}
