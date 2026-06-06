// A grab-bag of focused long-tail factories/parsers:
// NIP-50 search, NIP-78 app data, NIP-38 status, NIP-84 highlights,
// NIP-22 comments, NIP-28 channels, NIP-88 polls, NIP-99 classifieds,
// NIP-70 protected, NIP-40 expiration, NIP-14 subject.
import type { EventTemplate, Filter, NostrEvent } from '@hopstr/core'

// ── NIP-50: search filter ──
export function searchFilter(query: string, extra: Filter = {}): Filter {
  return { ...extra, search: query }
}

// ── NIP-78: application-specific data (kind 30078) ──
export function appData(appId: string, data: string): EventTemplate {
  return { kind: 30078, content: data, tags: [['d', appId]] }
}
export function parseAppData(event: NostrEvent): { appId: string; data: string } {
  return { appId: event.tags.find((t) => t[0] === 'd')?.[1] ?? '', data: event.content }
}

// ── NIP-38: user status (kind 30315) ──
export function status(statusType: 'general' | 'music' | string, content: string, expiration?: number): EventTemplate {
  const tags: string[][] = [['d', statusType]]
  if (expiration !== undefined) tags.push(['expiration', String(expiration)])
  return { kind: 30315, content, tags }
}

// ── NIP-84: highlights (kind 9802) ──
export function highlight(text: string, source: { eventId?: string; url?: string; author?: string }): EventTemplate {
  const tags: string[][] = []
  if (source.eventId) tags.push(['e', source.eventId])
  if (source.url) tags.push(['r', source.url])
  if (source.author) tags.push(['p', source.author])
  return { kind: 9802, content: text, tags }
}

// ── NIP-22: comment (kind 1111) — uppercase root scope, lowercase parent ──
export function comment(content: string, root: { id: string; kind: number; pubkey: string }, parent?: { id: string; kind: number; pubkey: string }): EventTemplate {
  const p = parent ?? root
  return {
    kind: 1111,
    content,
    tags: [
      ['E', root.id],
      ['K', String(root.kind)],
      ['P', root.pubkey],
      ['e', p.id],
      ['k', String(p.kind)],
      ['p', p.pubkey],
    ],
  }
}

// ── NIP-28: public channels (kinds 40/42) ──
export function createChannel(metadata: { name: string; about?: string; picture?: string }): EventTemplate {
  return { kind: 40, content: JSON.stringify(metadata), tags: [] }
}
export function channelMessage(channelId: string, content: string, relay = ''): EventTemplate {
  return { kind: 42, content, tags: [['e', channelId, relay, 'root']] }
}

// ── NIP-88: polls (kind 1068) ──
export interface PollInput {
  question: string
  options: Array<{ id: string; label: string }>
  multiple?: boolean
  endsAt?: number
}
export function poll(input: PollInput): EventTemplate {
  const tags: string[][] = input.options.map((o) => ['option', o.id, o.label])
  tags.push(['polltype', input.multiple ? 'multiplechoice' : 'singlechoice'])
  if (input.endsAt !== undefined) tags.push(['endsAt', String(input.endsAt)])
  return { kind: 1068, content: input.question, tags }
}
export function pollResponse(pollId: string, optionIds: string[]): EventTemplate {
  return { kind: 1018, content: '', tags: [['e', pollId], ...optionIds.map((id) => ['response', id])] }
}

// ── NIP-99: classified listings (kind 30402) ──
export interface ListingInput {
  slug: string
  title: string
  summary?: string
  price?: { amount: string; currency: string }
  images?: string[]
  description: string
}
export function classifiedListing(l: ListingInput): EventTemplate {
  const tags: string[][] = [['d', l.slug], ['title', l.title]]
  if (l.summary) tags.push(['summary', l.summary])
  if (l.price) tags.push(['price', l.price.amount, l.price.currency])
  for (const img of l.images ?? []) tags.push(['image', img])
  return { kind: 30402, content: l.description, tags }
}

// ── NIP-70: protected events (the `-` tag) ──
export function asProtected(template: EventTemplate): EventTemplate {
  return { ...template, tags: [...template.tags, ['-']] }
}
export function isProtected(event: NostrEvent): boolean {
  return event.tags.some((t) => t[0] === '-')
}

// ── NIP-40: expiration ──
export function withExpiration(template: EventTemplate, unixSeconds: number): EventTemplate {
  return { ...template, tags: [...template.tags, ['expiration', String(unixSeconds)]] }
}

// ── NIP-14: subject ──
export function withSubject(template: EventTemplate, subject: string): EventTemplate {
  return { ...template, tags: [...template.tags, ['subject', subject]] }
}
