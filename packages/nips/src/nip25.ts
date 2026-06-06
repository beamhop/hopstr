// NIP-25: reactions (kind 7). content "+" (like), "-" (dislike), or an emoji.
import { addressOf, type EventTemplate, type NostrEvent } from '@hopstr/core'

/** React to an event. content defaults to "+" (a like). */
export function react(event: NostrEvent, content = '+', relay = ''): EventTemplate {
  const tags: string[][] = [
    ['e', event.id, relay],
    ['p', event.pubkey],
    ['k', String(event.kind)],
  ]
  if (event.kind >= 30000 && event.kind < 40000) tags.push(['a', addressOf(event)])
  return { kind: 7, content, tags }
}

/** React with a NIP-30 custom emoji (`:shortcode:` + an emoji tag). */
export function customReact(event: NostrEvent, shortcode: string, imageUrl: string, relay = ''): EventTemplate {
  const base = react(event, `:${shortcode}:`, relay)
  base.tags.push(['emoji', shortcode, imageUrl])
  return base
}

export interface Reaction {
  content: string
  eventId?: string
  authorPubkey?: string
  isLike: boolean
  isDislike: boolean
}

/** Parse a kind-7 reaction. */
export function parseReaction(event: NostrEvent): Reaction {
  const eventId = event.tags.filter((t) => t[0] === 'e' && t[1]).map((t) => t[1]!).at(-1)
  const authorPubkey = event.tags.filter((t) => t[0] === 'p' && t[1]).map((t) => t[1]!).at(-1)
  const out: Reaction = {
    content: event.content,
    isLike: event.content === '+' || event.content === '',
    isDislike: event.content === '-',
  }
  if (eventId) out.eventId = eventId
  if (authorPubkey) out.authorPubkey = authorPubkey
  return out
}
