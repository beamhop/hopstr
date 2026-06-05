// NIP-17 private direct messages: a kind-14 chat rumor, gift-wrapped (NIP-59)
// separately to each recipient AND to the sender. Routed to kind-10050 relays.
import {
  getPublicKey,
  type EventTemplate,
  type NostrEvent,
  type Pubkey,
} from '@nostragent/core'
import { unwrap, wrapTemplate, type Rumor, type WrapClock } from './nip59.ts'

export const CHAT_KIND = 14
export const FILE_KIND = 15
export const DM_RELAYS_KIND = 10050

export interface DirectMessage {
  text: string
  /** all recipients (the conversation participants, excluding the sender) */
  to: Pubkey[]
  /** reply to an earlier message id */
  replyTo?: string
  subject?: string
}

/** The kind-14 chat rumor template (unsigned by design). */
export function chatTemplate(dm: DirectMessage, clock?: WrapClock): EventTemplate {
  const tags: string[][] = dm.to.map((pk) => ['p', pk])
  if (dm.replyTo) tags.push(['e', dm.replyTo])
  if (dm.subject) tags.push(['subject', dm.subject])
  const t: EventTemplate = { kind: CHAT_KIND, content: dm.text, tags }
  if (clock) t.created_at = clock.now()
  return t
}

/**
 * Build the gift wraps for a DM: one per recipient plus one to the sender, so
 * everyone (including you) can read the thread. Returns `{ recipient, wrap }`
 * pairs — publish each wrap to that recipient's kind-10050 relays.
 */
export function sealDirectMessage(
  dm: DirectMessage,
  senderSecret: Uint8Array | string,
  clock?: WrapClock,
): Array<{ recipient: Pubkey; wrap: NostrEvent }> {
  const template = chatTemplate(dm, clock)
  const sender = getPublicKey(senderSecret)
  const everyone = [...new Set<Pubkey>([...dm.to, sender])]
  return everyone.map((recipient) => ({
    recipient,
    wrap: wrapTemplate(template, senderSecret, recipient, clock),
  }))
}

export interface ReceivedMessage {
  from: Pubkey
  to: Pubkey[]
  text: string
  at: number
  replyTo?: string
  subject?: string
}

/** Unwrap a gift wrap into a chat message (throws if it isn't a kind-14 DM). */
export function openDirectMessage(giftWrap: NostrEvent, recipientSecret: Uint8Array | string): ReceivedMessage {
  const rumor = unwrap(giftWrap, recipientSecret)
  if (rumor.kind !== CHAT_KIND && rumor.kind !== FILE_KIND) {
    throw new Error(`gift wrap did not contain a NIP-17 message (kind ${rumor.kind})`)
  }
  return toReceived(rumor)
}

function toReceived(rumor: Rumor): ReceivedMessage {
  const msg: ReceivedMessage = {
    from: rumor.pubkey as Pubkey,
    to: rumor.tags.filter((t) => t[0] === 'p' && t[1]).map((t) => t[1] as Pubkey),
    text: rumor.content,
    at: rumor.created_at,
  }
  const replyTo = rumor.tags.find((t) => t[0] === 'e')?.[1]
  const subject = rumor.tags.find((t) => t[0] === 'subject')?.[1]
  if (replyTo) msg.replyTo = replyTo
  if (subject) msg.subject = subject
  return msg
}

/** Build a kind-10050 DM relay list (where this user wants to receive DMs). */
export function dmRelayList(relays: string[]): EventTemplate {
  return { kind: DM_RELAYS_KIND, content: '', tags: relays.map((r) => ['relay', r]) }
}

/** Parse a kind-10050 into its relay URLs. */
export function parseDmRelayList(event: NostrEvent): string[] {
  return event.tags.filter((t) => t[0] === 'relay' && t[1]).map((t) => t[1]!)
}
