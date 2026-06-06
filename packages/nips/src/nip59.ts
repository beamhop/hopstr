// NIP-59 gift wrap: rumor → seal (kind 13) → gift wrap (kind 1059).
// A fresh ephemeral key per wrap; timestamps randomized up to 2 days into the
// past (never future) to thwart time-analysis.
import {
  createIdentity,
  finalizeEvent,
  getEventHash,
  getPublicKey,
  nip44,
  verifyEvent,
  type EventTemplate,
  type NostrEvent,
  type Pubkey,
} from '@hopstr/core'

const SEAL_KIND = 13
const WRAP_KIND = 1059
const TWO_DAYS = 2 * 24 * 60 * 60

/** An unsigned event ("rumor"): full fields + id, but no signature. */
export interface Rumor {
  id: string
  pubkey: string
  created_at: number
  kind: number
  tags: string[][]
  content: string
}

export interface WrapClock {
  /** current unix seconds */
  now: () => number
  /** a random float in [0,1) used to back-date timestamps */
  random: () => number
}

const realClock: WrapClock = {
  now: () => Math.floor(Date.now() / 1000),
  random: () => Math.random(),
}

/** A timestamp randomly tweaked up to 2 days into the past (never future). */
function jitteredPast(clock: WrapClock): number {
  return clock.now() - Math.floor(clock.random() * TWO_DAYS)
}

/** Turn a template into an unsigned rumor authored by `pubkey`. */
export function createRumor(template: EventTemplate, pubkey: Pubkey, clock: WrapClock = realClock): Rumor {
  const base = {
    pubkey,
    created_at: template.created_at ?? clock.now(),
    kind: template.kind,
    tags: template.tags,
    content: template.content,
  }
  return { ...base, id: getEventHash(base) }
}

/**
 * Gift-wrap a rumor for one recipient. The seal is signed by `senderSecret`'s
 * key; the wrap by a fresh ephemeral key. Both encrypt with NIP-44 to the
 * recipient. Returns the signed kind-1059 gift wrap.
 */
export function wrap(
  rumor: Rumor,
  senderSecret: Uint8Array | string,
  recipient: Pubkey,
  clock: WrapClock = realClock,
): NostrEvent {
  // seal (kind 13): encrypt the rumor from the real sender to the recipient
  const sealedContent = nip44.encryptTo(JSON.stringify(rumor), senderSecret, recipient)
  const seal = finalizeEvent(
    { kind: SEAL_KIND, content: sealedContent, tags: [], created_at: jitteredPast(clock) },
    senderSecret,
  )

  // gift wrap (kind 1059): encrypt the seal from a fresh ephemeral key
  const ephemeral = createIdentity()
  const wrappedContent = nip44.encryptTo(JSON.stringify(seal), ephemeral.secretKey, recipient)
  return finalizeEvent(
    {
      kind: WRAP_KIND,
      content: wrappedContent,
      tags: [['p', recipient]],
      created_at: jitteredPast(clock),
    },
    ephemeral.secretKey,
  )
}

/** Wrap a template directly (creates the rumor for you). */
export function wrapTemplate(
  template: EventTemplate,
  senderSecret: Uint8Array | string,
  recipient: Pubkey,
  clock: WrapClock = realClock,
): NostrEvent {
  const rumor = createRumor(template, getPublicKey(senderSecret), clock)
  return wrap(rumor, senderSecret, recipient, clock)
}

/**
 * Unwrap a gift wrap with the recipient's secret. Verifies the seal signature
 * and that the seal author matches the rumor author. Returns the rumor.
 */
export function unwrap(giftWrap: NostrEvent, recipientSecret: Uint8Array | string): Rumor {
  if (giftWrap.kind !== WRAP_KIND) throw new Error('not a kind-1059 gift wrap')
  const sealJson = nip44.decryptFrom(giftWrap.content, recipientSecret, giftWrap.pubkey)
  const seal = JSON.parse(sealJson) as NostrEvent
  if (seal.kind !== SEAL_KIND) throw new Error('inner event is not a kind-13 seal')
  if (!verifyEvent(seal)) throw new Error('seal signature is invalid')
  const rumorJson = nip44.decryptFrom(seal.content, recipientSecret, seal.pubkey)
  const rumor = JSON.parse(rumorJson) as Rumor
  if (rumor.pubkey !== seal.pubkey) throw new Error('rumor author does not match seal author')
  return rumor
}
